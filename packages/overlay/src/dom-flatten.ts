/**
 * Flattens the LIVE, rendered DOM into the same `Block`/`Segment` shape `@voxfold/lang-html`
 * produces from a source file — so the exact same `lint()` from `@voxfold/core` runs against
 * whatever the browser actually shows, including text that came from a prop, a `.map()`, or
 * client-side state, which no static file adapter could ever see.
 *
 * Uses the same block/inline element vocabulary as `@voxfold/lang-html` (paragraphs, headings,
 * list items… flattened through inline tags) so scores from `voxfold` the CLI and the live
 * overlay agree on what counts as one sentence, not two different opinions of "prose."
 *
 * `Segment.node` here is NOT a file `NodeRef` — offsets don't mean anything for live DOM text — it
 * is a `{path, type: 'dom-text'}` pair whose `path` indexes into `TextRefTable`, the side table
 * this module returns alongside each `Block`. That table is how a flag on a `Block` gets back to
 * the actual `Text` node and character range to highlight or resolve against a stamp id.
 */

import { type Block, BlockBuilder, type BlockKind, type NodeRef } from '@voxfold/core'

/** Block-level elements that hold page copy — identical vocabulary to the HTML adapter. */
const BLOCK_ELEMENTS: Record<string, BlockKind> = {
  P: 'paragraph',
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  H4: 'heading',
  H5: 'heading',
  H6: 'heading',
  LI: 'listItem',
  BLOCKQUOTE: 'blockquote',
  TD: 'tableCell',
  TH: 'tableCell',
  FIGCAPTION: 'caption',
  DD: 'paragraph',
  DT: 'label',
  SUMMARY: 'label',
  LABEL: 'label',
  BUTTON: 'label',
}

const INLINE_ELEMENTS = new Set([
  'A',
  'ABBR',
  'B',
  'BDI',
  'BDO',
  'CITE',
  'DATA',
  'DEL',
  'DFN',
  'EM',
  'I',
  'INS',
  'MARK',
  'Q',
  'S',
  'SMALL',
  'SPAN',
  'STRONG',
  'SUB',
  'SUP',
  'TIME',
  'U',
  'VAR',
  'WBR',
])

const SKIP_ELEMENTS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'CODE',
  'PRE',
  'KBD',
  'SAMP',
  'SVG',
  'MATH',
  'CANVAS',
  'HEAD',
  'TITLE',
  'IFRAME',
  'OBJECT',
  'SELECT',
  'OPTION',
  'TEXTAREA',
])

const PLACEHOLDER_ELEMENTS = new Set(['CODE', 'KBD', 'SAMP', 'VAR', 'BR', 'IMG'])

const MIN_BLOCK_WORDS = 4

/** One entry per text ref handed out; `path` in a segment's `NodeRef` indexes into this array. */
export interface TextRef {
  node: Text
  /** Character offset within `node.data` where this ref's span starts. */
  start: number
  end: number
}

export interface DomFlattenResult {
  blocks: Block[]
  /** Indexed by the numeric string in each text segment's `NodeRef.path`. */
  refs: TextRef[]
}

function isHidden(element: Element): boolean {
  if (element.hasAttribute('hidden')) return true
  if (element.getAttribute('aria-hidden') === 'true') return true
  const style = (element as HTMLElement).style
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return true
  return false
}

function matchesAny(element: Element, selectors: readonly string[]): boolean {
  return selectors.some((selector) => {
    try {
      return element.matches(selector)
    } catch {
      return false
    }
  })
}

export interface DomFlattenOptions {
  /** Extra CSS selectors to skip entirely (vendor widgets, cookie banners…). */
  skipSelectors?: string[]
  /** The overlay's own root element, always skipped so it never lints itself. */
  overlayRoot?: Element
  minBlockWords?: number
}

type DomChildNode = Node

export function flattenDocument(
  root: ParentNode,
  options: DomFlattenOptions = {},
): DomFlattenResult {
  const skipSelectors = options.skipSelectors ?? []
  const minWords = options.minBlockWords ?? MIN_BLOCK_WORDS
  const blocks: Block[] = []
  const refs: TextRef[] = []
  let counter = 0

  function nextRefPath(node: Text, start: number, end: number): NodeRef {
    const path = String(refs.length)
    refs.push({ node, start, end })
    return { path, type: 'dom-text' }
  }

  function buildBlock(element: Element, kind: BlockKind): Block | undefined {
    const builder = new BlockBuilder()

    function walk(node: DomChildNode): void {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node as Text
        const collapsed = collapseWhitespace(text.data)
        if (collapsed.text.trim().length === 0) {
          if (collapsed.text.length > 0) builder.addBoundary()
          return
        }
        const { text: trimmed, offsetShift } = trimForPosition(collapsed, builder.length === 0)
        if (trimmed.length === 0) return
        // A live DOM Text node has no "source offset" — the ref itself, not an offset pair, is
        // what carries the connection back to this exact node, so srcStart/srcEnd are the FLAT
        // range (0..length), which is what BlockBuilder requires when a charMap isn't meaningful.
        builder.addText(trimmed, 0, trimmed.length, {
          node: nextRefPath(text, offsetShift, offsetShift + trimmed.length),
        })
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const el = node as Element
      if (options.overlayRoot && el === options.overlayRoot) return
      if (isHidden(el)) return
      if (matchesAny(el, skipSelectors)) return

      // Checked BEFORE the generic skip list: `code`/`kbd`/`samp`/`var` appear in both sets, and
      // inside an inline run of text they must become a placeholder (keeping the sentence shape
      // intact — "Run `npm i` now" stays three words plus a placeholder) rather than vanish
      // outright, which SKIP_ELEMENTS' blanket "never prose" rule would otherwise do first.
      if (PLACEHOLDER_ELEMENTS.has(el.tagName)) {
        builder.addPlaceholder(0, 0, { lockReason: 'inline-tag' })
        return
      }
      if (SKIP_ELEMENTS.has(el.tagName)) return
      if (INLINE_ELEMENTS.has(el.tagName)) {
        for (const child of Array.from(el.childNodes)) walk(child as DomChildNode)
        return
      }
      // A nested block element (a <p> inside an <li>) is its own block, handled by the outer
      // walk; here it only contributes a boundary so the surrounding sentence doesn't glue to it.
      builder.addBoundary()
    }

    for (const child of Array.from(element.childNodes)) walk(child as DomChildNode)
    const { block } = builder.build({ id: `dom#${counter++}`, kind, context: { weight: 1 } })
    if (block.text.trim().split(/\s+/).filter(Boolean).length < minWords) return undefined
    return block.text.trim().length > 0 ? block : undefined
  }

  function visit(node: ParentNode): void {
    for (const child of Array.from(node.children)) {
      if (options.overlayRoot && child === options.overlayRoot) continue
      if (SKIP_ELEMENTS.has(child.tagName) || isHidden(child)) continue
      if (matchesAny(child, skipSelectors)) continue

      const kind = BLOCK_ELEMENTS[child.tagName]
      if (kind) {
        const block = buildBlock(child, kind)
        if (block) blocks.push(block)
        // Still descend: a <li> may contain its own <p>, which is a separate block.
      }
      visit(child)
    }
  }

  visit(root)
  return { blocks, refs }
}

/** Collapse whitespace runs the way a browser renders them (CSS `white-space: normal`). */
function collapseWhitespace(raw: string): { text: string } {
  return { text: raw.replace(/\s+/g, ' ') }
}

/**
 * Drop leading space at the very start of a block (markup indentation), and collapse trailing
 * space down to at most one. The one trailing space is deliberately KEPT, not stripped, matching
 * `trimEdges` in `@voxfold/lang-html` — dropping it entirely would glue this text node to
 * whatever comes next ("the cat " + "sat" must stay "the cat sat", not become "the catsat").
 */
function trimForPosition(
  collapsed: { text: string },
  atBlockStart: boolean,
): { text: string; offsetShift: number } {
  let text = collapsed.text
  let offsetShift = 0
  if (atBlockStart && text.startsWith(' ')) {
    text = text.slice(1)
    offsetShift = 1
  }
  return { text, offsetShift }
}
