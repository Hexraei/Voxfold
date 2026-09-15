/**
 * `data-vf` stamping for markdown rendered through a FRAMEWORK'S OWN pipeline (Astro's
 * `markdown.rehypePlugins`, `@mdx-js/rollup`'s `rehypePlugins`) rather than linted as a raw file.
 *
 * Lives inside `@voxfold/lang-markdown` (exported as a subpath, `@voxfold/lang-markdown/stamp`)
 * rather than as its own package: it needs the exact same block vocabulary and `NodeRef` scheme
 * `../index.ts`'s `extract()` already produces (a stamped element's refs must resolve through
 * `markdownWriter.locate()` unchanged, since the edit server patches the ORIGINAL markdown file,
 * never the rendered HTML) — putting it in its own package would mean either re-deriving that
 * scheme independently (a second place it could drift from extract()'s) or taking a dependency
 * back on this package anyway. A dedicated package would only make sense if some consumer needed
 * the stamping without also depending on `@voxfold/lang-markdown` for extract()/writer, and
 * neither Astro's integration nor `@mdx-js/rollup` usage in this repo needs that split.
 *
 * DESIGN: `extract()` already computes every block's `Segment[]`, each with a `src: SourceRange`
 * and (for editable text) a `NodeRef` that resolves via `markdownWriter`. This plugin runs
 * `extract()` once per file to get that data, then walks the RENDERED hast tree (which
 * `mdast-util-to-hast`/remark-rehype attaches the original mdast `position` to — verified
 * empirically: a `<p>`/`<h1>`/`<li>` hast element's `.position.start.offset` matches the source
 * offset of the mdast node it came from) and matches each stamped-worthy hast element to the
 * block whose overall span (first segment's start to last segment's end) it contains. No second,
 * independent tree walk or block-anchor vocabulary is needed — `extract()` and this plugin can
 * never disagree about what counts as a block, same guarantee every other adapter's `stamp()`
 * gets from sharing `collectBlocks` with its own `extract()`.
 */

import { createHash } from 'node:crypto'
import type { Block, ProseDocument, StampEntry } from '@voxfold/core'
import type { Element, Root as HastRoot } from 'hast'
import { visit } from 'unist-util-visit'
import { markdownAdapter } from './index.ts'

const STAMP_ID_LENGTH = 8

function stampId(relativePath: string, nodePath: string): string {
  return createHash('sha1')
    .update(`${relativePath}:${nodePath}`)
    .digest('hex')
    .slice(0, STAMP_ID_LENGTH)
}

/** Overall `[start, end)` source span a block's segments cover — the widest range any of the
 * hast element containing it could plausibly correspond to. */
function blockSpan(block: Block): { start: number; end: number } | undefined {
  let start: number | undefined
  let end: number | undefined
  for (const segment of block.segments) {
    if (!segment.src) continue
    if (start === undefined || segment.src.start < start) start = segment.src.start
    if (end === undefined || segment.src.end > end) end = segment.src.end
  }
  return start !== undefined && end !== undefined ? { start, end } : undefined
}

export interface StampRehypeOptions {
  /** Project-root-relative path of the file being rendered, used to derive stable stamp ids. */
  relativePath: string
  /** Parse as MDX (JSX, {expr}, imports). Defaults to true — see `../index.ts`'s `markdownWriter`
   * doc comment for why a plain .md file parses identically either way. */
  mdx?: boolean
  /** Called with every stamp entry produced for this file, so a caller (the Astro/MDX
   * integration) can register them with `@voxfold/edit-server`'s `StampRegistry`. Rehype plugins
   * run synchronously inside the host's own compile pipeline and have no return-value channel of
   * their own for anything but the mutated tree, so entries are reported via callback instead. */
  onEntries?: (entries: StampEntry[]) => void
}

/**
 * A `unified` plugin (works directly as a `rehypePlugins` entry for both Astro's
 * `markdown.rehypePlugins` and `@mdx-js/rollup`'s `rehypePlugins` — both accept a standard
 * `PluggableList`, verified against each package's own type declarations) that injects
 * `data-vf="<id>"` on every hast element corresponding to one of `extract()`'s prose blocks.
 *
 * Takes the ORIGINAL markdown/MDX source text directly (not `this.file` from the unified
 * pipeline) since a transformer only receives the already-parsed tree; the source is needed to
 * re-run `extract()` for the NodeRef/block data. Callers that only have a vfile in hand pass
 * `String(file)` / `file.value`.
 */
export function stampRehype(source: string, options: StampRehypeOptions) {
  return async (tree: HastRoot) => {
    const document = (await markdownAdapter.extract(source, {
      uri: options.relativePath,
      settings: { mdx: options.mdx ?? true },
    })) as ProseDocument

    const entries: StampEntry[] = []

    for (const block of document.blocks) {
      const span = blockSpan(block)
      if (!span) continue

      const refs = block.segments
        .filter((segment) => segment.kind === 'text' && segment.editable && segment.node)
        .map((segment) => segment.node!)
      if (refs.length === 0) continue

      // The narrowest hast element whose own span fully contains the block's span is its render
      // anchor — narrowest, not first-found, so a <li> containing a single <p> stamps the <p>
      // (the actual prose container) rather than the outer <li> when both spans coincide loosely.
      let anchor: Element | undefined
      let anchorWidth = Number.POSITIVE_INFINITY
      visit(tree, 'element', (node: Element) => {
        const position = node.position
        const start = position?.start.offset
        const end = position?.end.offset
        if (start === undefined || end === undefined) return
        if (start > span.start || end < span.end) return
        const width = end - start
        if (width < anchorWidth) {
          anchor = node
          anchorWidth = width
        }
      })
      if (!anchor) continue

      const nodePath = block.id
      const id = stampId(options.relativePath, nodePath)
      anchor.properties = { ...anchor.properties, 'data-vf': id }

      entries.push({
        id,
        relativePath: options.relativePath,
        format: document.format,
        nodePath,
        refs,
      })
    }

    options.onEntries?.(entries)
  }
}

export default stampRehype
