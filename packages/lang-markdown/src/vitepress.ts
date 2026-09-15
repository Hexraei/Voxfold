/**
 * VitePress support: `data-vf` stamping and resolve-time verification for markdown rendered
 * through VitePress's own pipeline, which is `markdown-it`-based, NOT a `remark`/rehype pipeline
 * — the build plan calls this out explicitly, and it's real: `markdown-it` is a line-oriented
 * CommonMark tokenizer with a completely different AST shape (a flat token stream, not a tree)
 * from `mdast`/`hast`, so `stamp.ts`'s hast-position-matching approach (see that module's doc)
 * cannot apply here at all — there is no hast tree to walk.
 *
 * DESIGN, per the build plan's own spec:
 *  1. `vitePressStampPlugin` is a `markdown-it` plugin (installed via VitePress's own `markdown-it`
 *     config hook) that records each stampable token's `data-vf` id alongside its `token.map` LINE
 *     RANGE (verified empirically against `markdown-it@15`: `token.map` is `[startLine, endLine)`,
 *     0-based, on the block-opening token — `heading_open`/`paragraph_open`/`list_item_open`) and
 *     its inline child's flattened `.content` — NOT a `NodeRef`, since `markdown-it` has no
 *     structural path scheme in common with `markdownWriter`'s mdast-based one.
 *  2. At EDIT-SERVER RESOLVE TIME (`resolveVitePressStamp`, called by the edit-server's `resolve`
 *     handler for stamps in this registry), the server re-parses the CURRENT file content with
 *     `remark` and looks for EXACTLY ONE paragraph-shaped block whose line range corresponds to
 *     the recorded one (mapped through the two formats' different line-numbering conventions —
 *     verified empirically: `markdown-it`'s half-open `[start0, end0)` and mdast's inclusive
 *     `[start1, end1]` line numbers agree once converted via `start1 = start0 + 1, end1 = end0`)
 *     AND whose flattened text matches the recorded content. Both conditions must hold, or the
 *     stamp resolves as UNRESOLVABLE — the overlay shows a "can't edit here" badge rather than
 *     guessing which paragraph moved. This is deliberately conservative: VitePress applies its own
 *     transforms (frontmatter-driven includes, custom containers, `<!--@include-->`) between the
 *     source file and what markdown-it actually tokenizes, so a stamped id's line range can
 *     legitimately go stale without the underlying prose block having moved at all — matching on
 *     BOTH position and content is what keeps a stale stamp from silently patching the wrong text.
 */

import { createHash } from 'node:crypto'
import type { ProseDocument } from '@voxfold/core'
import type MarkdownItType from 'markdown-it'
import { markdownAdapter } from './index.ts'

type MarkdownIt = InstanceType<typeof MarkdownItType>

/** Minimal structural shape of `markdown-it`'s `Token`/`StateCore` this module actually reads —
 * avoids fighting `@types/markdown-it`'s `export =` CJS namespace merge under `import type`,
 * which doesn't expose `MarkdownIt.StateCore`/`MarkdownIt.Token` cleanly as a renamed default
 * import's nested types. Structurally identical to the real types for the fields used here. */
interface StampToken {
  type: string
  map: [number, number] | null
  content: string
  hidden: boolean
  attrSet(name: string, value: string): void
}
interface StampState {
  tokens: StampToken[]
}

const STAMP_ID_LENGTH = 8

/** Block-opening token types whose INLINE CHILD holds real prose, matching `../index.ts`'s
 * BLOCK_KINDS coverage of what markdown-it itself tokenizes as a distinct text-bearing block.
 * `list_item_open`/`blockquote_open` are deliberately NOT here — verified empirically (see module
 * doc): every list item, tight or loose, always tokenizes an inner `paragraph_open`/`inline`
 * pair, so the paragraph (not its container) is the node to stamp; the only wrinkle is that a
 * TIGHT list's inner `paragraph_open` is `hidden: true` (the renderer never emits a `<p>` tag for
 * it), so stamping happens on `list_item_open` instead in exactly that case (see the walk below).
 */
const STAMPABLE_OPEN_TOKENS = new Set(['heading_open', 'paragraph_open', 'th_open', 'td_open'])

export interface VitePressStampEntry {
  id: string
  relativePath: string
  /** 0-based, half-open — markdown-it's own `token.map` convention, kept as-is (not converted to
   * mdast's 1-based inclusive convention) so this entry can be compared directly against a fresh
   * markdown-it parse if ever needed, and is converted only at the remark-comparison boundary in
   * `resolveVitePressStamp`. */
  startLine: number
  endLine: number
  /** The inline content markdown-it flattened for this block, used as the second, independent
   * check `resolveVitePressStamp` requires alongside the line range. */
  flatText: string
}

/** Walk backward from a hidden `paragraph_open` at index `i` to the nearest enclosing, still-open
 * `list_item_open` — the token stream is flat, so "enclosing" means the nearest preceding
 * `list_item_open` that hasn't yet been closed by a `list_item_close` between it and `i`. */
function findEnclosingListItem(tokens: StampToken[], i: number): StampToken | undefined {
  let depth = 0
  for (let j = i - 1; j >= 0; j--) {
    const t = tokens[j]!
    if (t.type === 'list_item_close') depth++
    else if (t.type === 'list_item_open') {
      if (depth === 0) return t
      depth--
    }
  }
  return undefined
}

function stampId(relativePath: string, startLine: number, index: number): string {
  return createHash('sha1')
    .update(`${relativePath}:${startLine}:${index}`)
    .digest('hex')
    .slice(0, STAMP_ID_LENGTH)
}

/**
 * `markdown-it` plugin: `md.use(vitePressStampPlugin, { relativePath, onEntries })`. Installed
 * through VitePress's `markdown.config(md) => md.use(...)` hook (see `../../astro`'s sibling
 * integration doc for the equivalent Astro wiring — VitePress has no comparable Vite-plugin-level
 * hook for this, since markdown compilation there happens inside its own `@vitepress/markdown`
 * package, not through a Vite transform this repo controls).
 */
export function vitePressStampPlugin(
  md: MarkdownIt,
  options: { relativePath: string; onEntries?: (entries: VitePressStampEntry[]) => void },
): void {
  md.core.ruler.push('voxfold_stamp', (state: StampState) => {
    const entries: VitePressStampEntry[] = []
    let index = 0

    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i]!
      if (!token.map || !STAMPABLE_OPEN_TOKENS.has(token.type)) continue

      const inline = state.tokens[i + 1]
      if (inline?.type !== 'inline' || inline.content.trim().length === 0) continue

      // A tight list's inner paragraph_open is `hidden: true` (the renderer never emits a <p> tag
      // for it — verified empirically, see module doc) — in that case the enclosing list_item_open
      // is the real visible DOM anchor, so the stamp goes there instead.
      const anchor =
        token.type === 'paragraph_open' && token.hidden
          ? findEnclosingListItem(state.tokens, i)
          : token
      if (!anchor) continue

      const id = stampId(options.relativePath, token.map[0], index++)
      anchor.attrSet('data-vf', id)
      entries.push({
        id,
        relativePath: options.relativePath,
        startLine: token.map[0],
        endLine: token.map[1],
        flatText: inline.content,
      })
    }

    options.onEntries?.(entries)
  })
}

export interface VitePressResolveResult {
  ok: true
  document: ProseDocument
  /** Index into `document.blocks` of the single matching block. */
  blockIndex: number
}

export interface VitePressUnresolvable {
  ok: false
  /** Human-ish reason, surfaced as the overlay's "can't edit here" badge tooltip. */
  reason: 'no-matching-block' | 'ambiguous-match' | 'content-mismatch'
}

/**
 * Resolve-time verification (see module doc, step 2). Re-parses `source` (the file's CURRENT
 * content, read fresh — never trust the stamp's recorded text as still accurate) with
 * `markdownAdapter`'s own `extract()`, then requires EXACTLY ONE block whose line range overlaps
 * the recorded one AND whose flattened text equals `entry.flatText` exactly. Returns the matched
 * block's index (for the caller to pull `NodeRef`s from its segments, the same way `stamp.ts`'s
 * rehype entries do) rather than a synthesized `NodeRef` directly, since the caller already needs
 * `document` for the actual edit and re-deriving refs here would be a second source of truth.
 */
export async function resolveVitePressStamp(
  source: string,
  entry: VitePressStampEntry,
): Promise<VitePressResolveResult | VitePressUnresolvable> {
  const document = (await markdownAdapter.extract(source, {
    uri: entry.relativePath,
  })) as ProseDocument

  // markdown-it: 0-based, half-open [start, end). mdast/remark (this adapter's block segments):
  // 1-based, inclusive — verified empirically (see module doc): start1 = start0 + 1, end1 = end0.
  const wantStartLine = entry.startLine + 1
  const wantEndLine = entry.endLine

  const candidates: number[] = []
  for (let i = 0; i < document.blocks.length; i++) {
    const block = document.blocks[i]!
    const lines = blockLineRange(block, source)
    if (!lines) continue
    if (lines.start <= wantEndLine && lines.end >= wantStartLine) candidates.push(i)
  }

  if (candidates.length === 0) return { ok: false, reason: 'no-matching-block' }
  if (candidates.length > 1) return { ok: false, reason: 'ambiguous-match' }

  const blockIndex = candidates[0]!
  const block = document.blocks[blockIndex]!
  if (block.text !== entry.flatText.trim() && block.text.trim() !== entry.flatText.trim()) {
    return { ok: false, reason: 'content-mismatch' }
  }

  return { ok: true, document, blockIndex }
}

/** 1-based inclusive source line range a block's segments span, derived from character offsets
 * (the only position info `Block`/`Segment` carry — see `stamp.ts`'s `blockSpan` for the same
 * offset-range derivation used there). */
function blockLineRange(
  block: ProseDocument['blocks'][number],
  source: string,
): { start: number; end: number } | undefined {
  let startOffset: number | undefined
  let endOffset: number | undefined
  for (const segment of block.segments) {
    if (!segment.src) continue
    if (startOffset === undefined || segment.src.start < startOffset)
      startOffset = segment.src.start
    if (endOffset === undefined || segment.src.end > endOffset) endOffset = segment.src.end
  }
  if (startOffset === undefined || endOffset === undefined) return undefined
  return { start: lineOf(source, startOffset), end: lineOf(source, endOffset) }
}

function lineOf(source: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === '\n') line++
  return line
}
