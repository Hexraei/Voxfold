/**
 * Astro adapter.
 *
 * Walks `@astrojs/compiler`'s `parse()` output rather than running regexes over source, so prose
 * that spans `<strong>doesn't just</strong>` is one flat string to the engine and offsets stay
 * exact. Same overall shape as `@voxfold/lang-vue`/`@voxfold/lang-svelte` (both HTML-shaped
 * template syntax), with the differences documented below.
 *
 * OFFSET SPIKE RESULT — UTF-8 BYTES, NOT UTF-16: `@astrojs/compiler`'s own type declares
 * `Point.offset` as "0-based byte offset", and this was verified empirically with a fixture
 * containing an emoji and curly quotes ahead of a plain-ASCII marker string: the marker's
 * `position.start.offset` landed at the UTF-8 byte index of the marker, not the UTF-16
 * `String.prototype.indexOf` index — and a `Text` node's `position.end.offset` also turned out to
 * be `start.offset + Buffer.byteLength(value, 'utf8')`, NOT `start.offset + value.length` (UTF-16
 * length), confirmed across four fixtures (plain ASCII, emoji-only, curly-quotes-only, and both
 * combined). Every other adapter in this repo, and `@voxfold/core`'s `Offset` type, assume UTF-16
 * code units — so every offset this adapter reads is converted through `ByteOffsetMap` (see
 * `byte-offsets.ts`) before anything downstream touches it. A `Text` node's UTF-16 span is
 * computed as `[start16, start16 + value.length)` rather than trusting a converted `end16`: even
 * after byte-to-UTF-16 conversion, a `Text` node's reported `end` can extend past its own decoded
 * `.value` into trailing markup (observed on some fixtures), while `start16 + value.length` always
 * reproduces `.value` exactly via `source.slice()` — verified against every spike fixture.
 *
 * ENTITY DECODING: unlike Svelte/Vue, `@astrojs/compiler`'s `text` node `.value` does NOT decode
 * HTML entities at all — verified empirically: parsing `Tom &amp; Jerry` produced `value: "Tom
 * &amp; Jerry"` verbatim, entities untouched, even for basic XML entities. This adapter has its
 * OWN entity-decoding layer (`template-entities.ts`, unlike lang-svelte's which only maps
 * offsets — the underlying compiler there already decodes) so extract() reports what a reader
 * sees, and so the writer's escape-on-write/decode-on-read round trip is actually lossless
 * (required by `@voxfold/writer`'s protocol, which checks the patched text reads back byte-exact
 * — an earlier version of this adapter skipped decoding and failed that check in a real test run,
 * not a hypothetical: see `writer/index.ts`'s `locate()`).
 *
 * `{expr}` PARSES AS A MIXED TREE, NOT AN OPAQUE JS AST: `@astrojs/compiler` parses `{...}` into
 * an `expression` node whose `children` interleave raw-JS-source `text` fragments with REAL
 * `element`/`component` nodes for any JSX embedded inside (e.g. `{items.map(i => <li>{i}</li>)}`
 * produces `text("items.map(i => ")`, `element("li", ...)`, `text(")")` as siblings) — verified
 * empirically. Descending into these text fragments would lint raw JavaScript source as prose, so
 * this adapter locks the WHOLE `expression` node as one placeholder and never descends into it —
 * the same choice `lang-jsx` makes for `JSXExpressionContainer` (see its module doc), and safer
 * than Svelte's `{#each}` handling (which can descend because Svelte's `EachBlock.body` is a
 * proper `Fragment`, not a mix of raw source text and markup).
 *
 * `set:html` is Astro's `v-html`/`{@html}` equivalent (an attribute, not a child node) and locks
 * its element. `<Foo>slotted text</Foo>` (a `component` node) is walked like any inline
 * container — its own text is prose (it's the component's slot content, authored right here in
 * this file), but per the block vocabulary below only recognized *host* elements anchor a block.
 */

import { parse as parseAstro } from '@astrojs/compiler'
import { parse as parseAstroSync } from '@astrojs/compiler/sync'
import type {
  AttributeNode,
  CommentNode,
  Node as CompilerNode,
  ComponentNode,
  CustomElementNode,
  ElementNode,
  ExpressionNode,
  FrontmatterNode,
  ParentLikeNode,
  RootNode,
  TextNode,
} from '@astrojs/compiler/types'
import {
  type Block,
  BlockBuilder,
  type BlockKind,
  type Directive,
  type ExtractContext,
  type LanguageAdapter,
  type LockReason,
  type NodeRef,
  type ProseDocument,
  parseDirectiveComment,
} from '@voxfold/core'
import type { AstNode } from './ast-path.ts'
import { structuralPathTo } from './ast-path.ts'
import { ByteOffsetMap } from './byte-offsets.ts'
import { stamp } from './stamp.ts'
import { decodeTemplateText, isLinear } from './template-entities.ts'
import { astroWriter } from './writer/index.ts'

export interface AstroSettings {
  /** Extra tag names treated as inline (flattened into the surrounding block). */
  extraInlineTags?: string[]
}

/** Elements that hold block-level prose, mapped to the engine's block kinds. Same vocabulary as
 * lang-vue/lang-svelte/lang-jsx. */
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

/** Inline elements flattened into the surrounding block. */
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

/** Elements whose content is never prose. */
const SKIP_ELEMENTS = new Set(['code', 'pre', 'svg', 'textarea', 'script', 'style'])

/** Best-effort classification of an `{expr}` from its raw leading source text, mirroring
 * lang-jsx's `lockReasonFor` — there is no real JS AST here to branch on (see module doc), only
 * the raw text @astrojs/compiler hands back for the non-markup portion of the expression. */
function lockReasonForExpression(node: ExpressionNode): LockReason {
  const leading = node.children.find((c): c is TextNode => c.type === 'text')
  const text = leading?.value.trim() ?? ''
  if (/\.map\s*\(/.test(text)) return 'map'
  if (/^(t|\$t|i18n)\s*\(/.test(text)) return 'i18n'
  if (/^`/.test(text)) return 'template-literal'
  if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(text)) return 'variable'
  return 'expression'
}

function findAttribute(
  node: { attributes: AttributeNode[] },
  name: string,
): AttributeNode | undefined {
  return node.attributes.find((attr) => attr.name === name)
}

export interface WalkState {
  source: string
  counter: number
  uri: string
  settings: AstroSettings
  root: RootNode
  bytes: ByteOffsetMap
}

function refFor(root: RootNode, node: AstNode, type: string): NodeRef {
  const path = structuralPathTo(root as unknown as AstNode, node)
  if (path === undefined) throw new Error('refFor: node not found under the given root')
  return { path, type }
}

type ElementLikeNode = ElementNode | ComponentNode | CustomElementNode

function isElementLike(node: CompilerNode): node is ElementLikeNode {
  return node.type === 'element' || node.type === 'component' || node.type === 'custom-element'
}

function isText(node: CompilerNode): node is TextNode {
  return node.type === 'text'
}

function isExpression(node: CompilerNode): node is ExpressionNode {
  return node.type === 'expression'
}

function isComment(node: CompilerNode): node is CommentNode {
  return node.type === 'comment'
}

/** UTF-16 `[start, end)` span for a text node's own decoded value (see module doc: `end` from
 * the AST can overshoot past the value into trailing markup, so it is never trusted directly). */
function textSpan16(node: TextNode, bytes: ByteOffsetMap): { start: number; end: number } {
  const start = bytes.toUtf16(node.position?.start.offset ?? 0)
  return { start, end: start + node.value.length }
}

/** UTF-16 `[start, end)` span for any node, trusting the AST's own `end` — only used for nodes
 * this adapter never re-derives a length for (expressions, elements, comments). */
function nodeSpan16(node: CompilerNode, bytes: ByteOffsetMap): { start: number; end: number } {
  const start = bytes.toUtf16(node.position?.start.offset ?? 0)
  const end = bytes.toUtf16(node.position?.end?.offset ?? node.position?.start.offset ?? 0)
  return { start, end }
}

/**
 * Walk a node's children, appending text/placeholders to `builder`. `locked`, when set, means
 * every Text encountered anywhere below becomes a locked placeholder rather than editable text —
 * used for `.map()`-classified expressions, matching lang-svelte's `{#each}` treatment (this
 * adapter locks the WHOLE expression rather than descending, per the module doc, so `locked` here
 * only ever applies to elements found through some OTHER already-locked ancestor, not through
 * descending into an expression's own children).
 */
function walkChildren(
  nodes: readonly CompilerNode[],
  builder: BlockBuilder,
  state: WalkState,
  locked: LockReason | undefined,
): void {
  for (const child of nodes) {
    if (isText(child)) {
      if (child.value.length === 0) continue
      const { start, end } = textSpan16(child, state.bytes)
      if (locked) {
        builder.addPlaceholder(start, end, {
          node: refFor(state.root, child as unknown as AstNode, 'text'),
          lockReason: locked,
        })
        continue
      }
      // .value is NOT entity-decoded by @astrojs/compiler (see module doc) — decode here so a
      // reader-visible `&amp;` reads as `&`, matching every other HTML-flavored adapter.
      const raw = state.source.slice(start, end)
      const { decoded, offsets } = decodeTemplateText(raw, start)
      if (decoded.length === 0) continue
      if (isLinear(offsets)) {
        builder.addText(decoded, offsets[0]!, offsets[0]! + decoded.length, {
          node: refFor(state.root, child as unknown as AstNode, 'text'),
        })
      } else {
        builder.addText(decoded, start, end, {
          charMap: offsets,
          node: refFor(state.root, child as unknown as AstNode, 'text'),
        })
      }
      continue
    }

    if (isExpression(child)) {
      const { start, end } = nodeSpan16(child, state.bytes)
      builder.addPlaceholder(start, end, {
        node: refFor(state.root, child as unknown as AstNode, 'expression'),
        lockReason: locked ?? lockReasonForExpression(child),
      })
      continue
    }

    if (isComment(child)) continue

    if (isElementLike(child)) {
      const name = child.name
      if (SKIP_ELEMENTS.has(name)) continue

      // set:html REPLACES this element's content entirely at runtime — Astro's v-html/{@html}
      // equivalent — so it locks the element rather than treating its (usually empty) children
      // as prose.
      if (findAttribute(child, 'set:html')) {
        const { start, end } = nodeSpan16(child, state.bytes)
        builder.addPlaceholder(start, end, {
          node: refFor(state.root, child as unknown as AstNode, 'set-html'),
          lockReason: 'html-injection',
        })
        continue
      }

      const isInline =
        INLINE_ELEMENTS.has(name) || (state.settings.extraInlineTags ?? []).includes(name)
      if (isInline || child.type === 'component' || child.type === 'custom-element') {
        // A component/custom-element's children are its slot content, authored right here in
        // this file — treated as inline (flattened into the surrounding block) since a component
        // is never itself a recognized block anchor (see BLOCK_ELEMENTS: only host tag names).
        walkChildren(child.children, builder, state, locked)
        continue
      }
      // A nested block-level host element (a <p> inside an <li>): the outer walk handles it as
      // its own block; this element contributes only a boundary here.
      builder.addBoundary()
    }
  }
}

/** Flatten one element's children into a single block, or undefined if it holds no prose. */
function buildBlock(
  element: ElementLikeNode,
  id: string,
  kind: BlockKind,
  state: WalkState,
  inherited: LockReason | undefined,
): Block | undefined {
  const builder = new BlockBuilder()
  walkChildren(element.children, builder, state, inherited)
  const { block } = builder.build({ id, kind, context: { weight: 1 } })
  return block.text.trim().length > 0 ? block : undefined
}

function lineOf(source: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === '\n') line++
  return line
}

function collectDirectiveComments(
  root: RootNode,
  source: string,
  bytes: ByteOffsetMap,
): Directive[] {
  const directives: Directive[] = []
  const visit = (node: CompilerNode): void => {
    if (isComment(node)) {
      const { start, end } = nodeSpan16(node, bytes)
      const directive = parseDirectiveComment(node.value, { start, end }, lineOf(source, start))
      if (directive) directives.push(directive)
      return
    }
    if (isElementLike(node) || isExpression(node)) {
      for (const child of node.children) visit(child)
    }
  }
  for (const child of root.children) visit(child)
  return directives
}

export async function parseAstroFile(text: string): Promise<RootNode> {
  const result = await parseAstro(text, { position: true })
  return result.ast
}

/**
 * Synchronous parse, for `stamp()` and the writer — both hooks are sync-only per
 * `LanguageAdapter`/`AdapterWriter`'s contract (`extract()` is the only hook allowed to return a
 * `Promise`). `@astrojs/compiler/sync` is a genuine synchronous entry point (backed by
 * `startRunningService()`, not a blocking wrapper over the async API) — verified empirically that
 * it returns a real parse result with no `await` involved.
 */
export function parseAstroFileSync(text: string): RootNode {
  return parseAstroSync(text, { position: true }).ast
}

export interface CollectedBlock {
  element: ElementLikeNode
  /** Structural path of `element` itself — stable across unrelated edits, unlike a counter. */
  elementPath: string
  block: Block
}

/**
 * Every element that anchors a prose block, paired with the `Block` it produced. Shared by
 * `extract()` (which only needs the blocks) and `stamp()` (which needs the element too, to know
 * where in the source to inject `data-vf`) so the two never disagree about what counts as a block.
 * Frontmatter (the `---`-fenced block) is a sibling `frontmatter` node under `root.children`,
 * never descended into by this walk — it holds no template prose by construction.
 */
export function collectBlocks(root: RootNode, state: WalkState): CollectedBlock[] {
  const collected: CollectedBlock[] = []

  const visit = (nodes: readonly CompilerNode[], inherited: LockReason | undefined): void => {
    for (const node of nodes) {
      if (isElementLike(node)) {
        const name = node.name
        if (!SKIP_ELEMENTS.has(name) && !findAttribute(node, 'set:html')) {
          const kind = node.type === 'element' ? BLOCK_ELEMENTS[name] : undefined
          if (kind) {
            const block = buildBlock(
              node,
              `${state.uri}#${state.counter++}`,
              kind,
              state,
              inherited,
            )
            if (block) {
              collected.push({
                element: node,
                elementPath:
                  structuralPathTo(state.root as unknown as AstNode, node as unknown as AstNode) ??
                  '',
                block,
              })
            }
          }
          // Still descend: a block element may itself contain further nested block elements (a
          // <p> inside an <li>), or a component whose slot contains further block elements.
          visit(node.children, inherited)
        }
      } else if (isExpression(node)) {
        // Per the module doc: the whole expression is locked as one placeholder in extract()'s
        // flattened text, but embedded elements inside it (e.g. `.map(i => <li>...)`) are still
        // real, separately-anchored blocks in the FILE overall — an editor should still be able
        // to edit the <li>'s own text even though the surrounding {expr} itself is locked. Any
        // text directly inside that embedded element that ISN'T further nested in another
        // element is, however, driven by the iteration/expression, so it's still locked — same
        // treatment as lang-svelte's {#each} body.
        const reason = lockReasonForExpression(node) === 'map' ? 'map' : (inherited ?? 'expression')
        visit(node.children, reason)
      }
      // Text/Comment/Frontmatter/Doctype nodes hold no further element descendants.
    }
  }

  visit(root.children, undefined)
  return collected
}

function extract(text: string, context: ExtractContext): Promise<ProseDocument> {
  const settings = (context.settings ?? {}) as AstroSettings
  return parseAstroFile(text).then((root) => {
    const bytes = new ByteOffsetMap(text)
    const state: WalkState = { source: text, counter: 0, uri: context.uri, settings, root, bytes }
    const blocks = collectBlocks(root, state).map(({ block }) => block)

    return {
      uri: context.uri,
      format: 'astro',
      source: text,
      blocks,
      directives: collectDirectiveComments(root, text, bytes),
    }
  })
}

export const astroAdapter: LanguageAdapter = {
  id: 'astro',
  extensions: ['.astro'],
  extract,
  stamp,
  writer: astroWriter,
}

export default astroAdapter

export type { FrontmatterNode, ParentLikeNode }
