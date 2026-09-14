/**
 * HTML adapter.
 *
 * Powers `voxfold https://yoursite.com` and linting of .html files. Uses parse5 with location
 * info rather than regexes, so entities decode correctly and every flag maps back to real offsets.
 *
 * Deciding what counts as page copy is most of the work. Navigation labels, cookie banners and
 * chat widgets are not the site's writing, and counting them would make scores depend on which
 * vendor scripts a page happens to embed.
 */

import {
  type Block,
  BlockBuilder,
  type BlockKind,
  type Directive,
  type ExtractContext,
  type LanguageAdapter,
  type ProseDocument,
  parseDirectiveComment,
  type Region,
} from '@voxfold/core'
// parse5 only exports its root, so the tree-adapter types come from the namespace it re-exports
// there rather than a deep path (which resolves at runtime but not for types).
import { type DefaultTreeAdapterTypes, parse } from 'parse5'
import { htmlWriter } from './writer/index.ts'

type ChildNode = DefaultTreeAdapterTypes.ChildNode
type Document = DefaultTreeAdapterTypes.Document
type Element = DefaultTreeAdapterTypes.Element
type TextNode = DefaultTreeAdapterTypes.TextNode

export interface HtmlSettings {
  /** Extra CSS-ish selectors to skip, as tag names, .class or #id. */
  skipSelectors?: string[]
  /** Blocks with fewer words than this are ignored (nav labels, buttons). Default 4. */
  minBlockWords?: number
}

/** Block-level elements that hold page copy, mapped to engine block kinds. */
const BLOCK_ELEMENTS: Record<string, BlockKind> = {
  p: 'paragraph',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  li: 'listItem',
  blockquote: 'blockquote',
  td: 'tableCell',
  th: 'tableCell',
  figcaption: 'caption',
  dd: 'paragraph',
  dt: 'label',
  summary: 'label',
  label: 'label',
  button: 'label',
}

/** Inline elements flattened into the surrounding sentence. */
const INLINE_ELEMENTS = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'cite',
  'data',
  'del',
  'dfn',
  'em',
  'i',
  'ins',
  'mark',
  'q',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
  'wbr',
])

/** Elements whose content is never page prose. */
const SKIP_ELEMENTS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'code',
  'pre',
  'kbd',
  'samp',
  'svg',
  'math',
  'canvas',
  'head',
  'title',
  'iframe',
  'object',
  'select',
  'option',
  'textarea',
])

/** Inline elements that stand in for non-prose content. */
const PLACEHOLDER_ELEMENTS = new Set(['code', 'kbd', 'samp', 'var', 'br', 'img'])

/**
 * Third-party widgets whose copy belongs to a vendor, not the site. Kept as data so a project
 * can extend it without a code change.
 */
const VENDOR_SELECTORS = [
  '#onetrust-consent-sdk',
  '.cookie-banner',
  '.cookie-consent',
  '#cookiescript_injected',
  '.cc-window',
  '#intercom-container',
  '.intercom-lightweight-app',
  '#drift-widget',
  '#hubspot-messages-iframe-container',
  '.crisp-client',
  '#usercentrics-root',
]

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node
}

function isText(node: ChildNode): node is TextNode {
  return node.nodeName === '#text'
}

function attr(element: Element, name: string): string | undefined {
  return element.attrs?.find((a) => a.name === name)?.value
}

/** True when this element matches one of the given tag / .class / #id selectors. */
function matchesAny(element: Element, selectors: readonly string[]): boolean {
  const id = attr(element, 'id')
  const classes = (attr(element, 'class') ?? '').split(/\s+/).filter(Boolean)
  return selectors.some((selector) => {
    if (selector.startsWith('#')) return id === selector.slice(1)
    if (selector.startsWith('.')) return classes.includes(selector.slice(1))
    return element.tagName === selector.toLowerCase()
  })
}

/** Hidden to a reader, so not part of the visible copy. */
function isHidden(element: Element): boolean {
  if (attr(element, 'hidden') !== undefined) return true
  if (attr(element, 'aria-hidden') === 'true') return true
  const style = attr(element, 'style') ?? ''
  return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)
}

/**
 * Which part of the page this element sits in. Footer and legal text is real copy but rarely
 * the voice being judged, so it is weighted at half rather than skipped.
 */
function regionOf(element: Element, inherited: Region | undefined): Region | undefined {
  const role = attr(element, 'role')
  if (element.tagName === 'nav' || role === 'navigation') return 'nav'
  if (element.tagName === 'footer' || role === 'contentinfo') return 'footer'
  if (element.tagName === 'main' || role === 'main') return 'main'
  const id = `${attr(element, 'id') ?? ''} ${attr(element, 'class') ?? ''}`
  if (/\b(legal|terms|privacy|disclaimer|copyright)\b/i.test(id)) return 'legal'
  return inherited
}

const REGION_WEIGHTS: Record<Region, number> = {
  main: 1,
  nav: 1,
  footer: 0.5,
  legal: 0.5,
}

interface Walker {
  source: string
  settings: HtmlSettings
  blocks: Block[]
  counter: number
  uri: string
  directives: Directive[]
}

function lineOf(source: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === '\n') line++
  return line
}

/**
 * Flatten one block element's inline content.
 *
 * HTML collapses runs of whitespace when rendering, so the flat text uses collapsed spacing while
 * the charMap still points at the original offsets. Without that, a flag's source range would
 * drift by one character for every collapsed newline in the markup.
 */
function buildBlock(
  element: Element,
  kind: BlockKind,
  path: string,
  walker: Walker,
  region: Region | undefined,
): Block | undefined {
  const builder = new BlockBuilder()

  const walk = (node: Element, nodePath: string): void => {
    node.childNodes?.forEach((child, index) => {
      const childPath = `${nodePath}.${index}`

      if (isText(child)) {
        const location = child.sourceCodeLocation
        if (!location) return
        const raw = walker.source.slice(location.startOffset, location.endOffset)
        const collapsed = collapseWhitespace(child.value, raw, location.startOffset)
        // Whitespace-only text between block tags is markup indentation, not a word gap.
        if (collapsed.text.trim().length === 0) {
          if (collapsed.text.length > 0) builder.addBoundary()
          return
        }
        const { text, charMap } = trimEdges(collapsed, builder.length === 0)
        if (text.length === 0) return
        builder.addText(text, location.startOffset, location.endOffset, {
          charMap,
          node: { path: childPath, type: '#text' },
        })
        return
      }

      if (!isElement(child)) return
      const location = child.sourceCodeLocation
      if (!location) return

      if (PLACEHOLDER_ELEMENTS.has(child.tagName)) {
        builder.addPlaceholder(location.startOffset, location.endOffset, {
          node: { path: childPath, type: child.tagName },
          lockReason: 'inline-tag',
        })
        return
      }
      if (SKIP_ELEMENTS.has(child.tagName) || isHidden(child)) return

      if (INLINE_ELEMENTS.has(child.tagName)) {
        walk(child, childPath)
        return
      }
      // A nested block element inside a block element (a <p> inside an <li>) is handled as its
      // own block by the outer walk, so it contributes a boundary here rather than its text.
      builder.addBoundary()
    })
  }

  walk(element, path)

  const resolvedRegion = region ?? 'main'
  const { block } = builder.build({
    id: `${walker.uri}#${walker.counter++}`,
    kind,
    context: {
      weight: REGION_WEIGHTS[resolvedRegion],
      region: resolvedRegion,
      ...(kind === 'heading' ? { headingDepth: Number(element.tagName.slice(1)) || 1 } : {}),
    },
  })

  const words = block.text.trim().split(/\s+/).filter(Boolean).length
  const minWords = walker.settings.minBlockWords ?? 4
  // Short blocks are navigation labels, buttons and table headers, not prose worth judging.
  if (words < minWords) return undefined
  return block
}

/**
 * Collapse whitespace the way a browser renders it, keeping a source offset per output character.
 *
 * Edge whitespace is preserved, not trimmed: in `platform <strong>doesn't</strong>` the space
 * before the tag is the only thing separating two words, and dropping it per text node would
 * glue them together. The builder collapses a run that meets an existing space.
 */
function collapseWhitespace(
  value: string,
  raw: string,
  start: number,
): { text: string; charMap: Int32Array } {
  // Walk the decoded value and the raw slice together so entities (&amp;) stay aligned.
  const offsets: number[] = []
  let out = ''
  let rawIndex = 0

  for (let i = 0; i < value.length; i++) {
    const char = value[i]!
    // Advance the raw cursor past an entity that produced this character.
    if (raw[rawIndex] === '&') {
      const semicolon = raw.indexOf(';', rawIndex)
      if (semicolon !== -1 && semicolon - rawIndex <= 10) {
        offsets.push(start + rawIndex)
        out += char
        rawIndex = semicolon + 1
        continue
      }
    }

    if (/\s/.test(char)) {
      // Collapse a run of whitespace to one space, keeping the run's first source offset.
      if (!out.endsWith(' ')) {
        offsets.push(start + rawIndex)
        out += ' '
      }
      // The HTML parser normalizes CRLF to a single newline in text values, so the source
      // consumed two characters where the value has one. Missing this drifts every later offset.
      rawIndex += char === '\n' && raw[rawIndex] === '\r' && raw[rawIndex + 1] === '\n' ? 2 : 1
      continue
    }

    offsets.push(start + rawIndex)
    out += char
    rawIndex++
  }

  return { text: out, charMap: Int32Array.from(offsets) }
}

/**
 * Drop leading whitespace at the start of a block (markup indentation) and always drop the
 * trailing space, which the next segment's own leading space would otherwise double.
 */
function trimEdges(
  collapsed: { text: string; charMap: Int32Array },
  atBlockStart: boolean,
): { text: string; charMap: Int32Array } {
  let from = 0
  let to = collapsed.text.length
  if (atBlockStart) while (from < to && collapsed.text[from] === ' ') from++
  while (to > from && collapsed.text[to - 1] === ' ') to--

  // Keep one trailing space when the node genuinely ended with one: it separates this text from
  // whatever inline tag follows.
  const hadTrailingSpace = collapsed.text.endsWith(' ') && to < collapsed.text.length
  const end = hadTrailingSpace ? to + 1 : to

  return {
    text: collapsed.text.slice(from, end),
    charMap: collapsed.charMap.slice(from, end),
  }
}

function extract(text: string, context: ExtractContext): ProseDocument {
  const settings = (context.settings ?? {}) as HtmlSettings
  const document: Document = parse(text, { sourceCodeLocationInfo: true })

  const walker: Walker = {
    source: text,
    settings,
    blocks: [],
    counter: 0,
    uri: context.uri,
    directives: [],
  }
  const skipSelectors = [...VENDOR_SELECTORS, ...(settings.skipSelectors ?? [])]

  const walk = (node: ChildNode, path: string, region: Region | undefined): void => {
    if (node.nodeName === '#comment') {
      const location = node.sourceCodeLocation
      const body = (node as unknown as { data?: string }).data ?? ''
      if (location) {
        const directive = parseDirectiveComment(
          body,
          { start: location.startOffset, end: location.endOffset },
          lineOf(text, location.startOffset),
        )
        if (directive) walker.directives.push(directive)
      }
      return
    }

    if (!isElement(node)) return
    if (SKIP_ELEMENTS.has(node.tagName)) return
    if (isHidden(node)) return
    if (matchesAny(node, skipSelectors)) return

    const nodeRegion = regionOf(node, region)
    const kind = BLOCK_ELEMENTS[node.tagName]

    if (kind) {
      const block = buildBlock(node, kind, path, walker, nodeRegion)
      if (block) walker.blocks.push(block)
      // Descend anyway: an <li> may contain a <p>, which is its own block.
    }

    node.childNodes?.forEach((child, index) => {
      if (kind && (isText(child) || (isElement(child) && INLINE_ELEMENTS.has(child.tagName)))) {
        // Already flattened into the block above.
        return
      }
      walk(child, `${path}.${index}`, nodeRegion)
    })
  }

  document.childNodes.forEach((child, index) => {
    walk(child, String(index), undefined)
  })

  return {
    uri: context.uri,
    format: 'html',
    source: text,
    blocks: walker.blocks,
    directives: walker.directives,
  }
}

/**
 * Detect a client-rendered page whose server HTML holds no copy.
 *
 * Scoring an empty shell would report a flattering 100 for a page the tool never actually read,
 * which is worse than refusing. The CLI prints an explanation instead.
 */
export function isClientRenderedShell(text: string, document: ProseDocument): boolean {
  const words = document.blocks.reduce(
    (sum, block) => sum + block.text.trim().split(/\s+/).filter(Boolean).length,
    0,
  )
  if (words >= 40) return false

  // An empty mount node is the decisive signal: the page says outright that its content arrives
  // later. Module scripts alone mean nothing — most server-rendered sites ship them too.
  const hasEmptyMount = /<div[^>]+id=["'](root|app|__next|__nuxt|svelte)["'][^>]*>\s*<\/div>/i.test(
    text,
  )
  if (hasEmptyMount) return true

  const hasModuleScripts = /<script[^>]+type=["']module["']/i.test(text)
  return words < 10 && hasModuleScripts
}

export const htmlAdapter: LanguageAdapter = {
  id: 'html',
  extensions: ['.html', '.htm'],
  extract,
  writer: htmlWriter,
}

export default htmlAdapter

/** Exposed so a project can see and extend what gets skipped. */
export { VENDOR_SELECTORS }
