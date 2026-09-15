/**
 * Vue SFC adapter.
 *
 * Walks `@vue/compiler-sfc`'s template AST rather than running regexes over source, so prose that
 * spans `<strong>doesn't just</strong>` is one flat string to the engine and offsets stay exact.
 *
 * OFFSET SPIKE RESULT (see the build plan's M9 risk note): `descriptor.template.ast` node
 * `loc.start.offset` / `loc.end.offset` values are already relative to the WHOLE SFC file, not to
 * the `<template>` block's own content — verified empirically (see scratch probes run while
 * building this adapter): parsing `<script setup>...</script>\n<template>\n  <p>hi</p>\n</template>`
 * and checking `p.children[0].loc.start.offset` against `sfc.indexOf('hi')` gave the SAME number
 * (16) with no addition of `descriptor.template.loc.start.offset` needed. `compileTemplate()`
 * (which re-parses `descriptor.template.content` in isolation) DOES produce template-relative
 * offsets, which is why this adapter walks `descriptor.template.ast` directly — the AST already
 * attached to the whole-file parse — rather than calling `compileTemplate()` a second time.
 *
 * Only elements holding real markup are ever prose. `<script>` and `<style>` blocks are not
 * walked at all — only `descriptor.template` is. A `v-html`-bound element's own content is never
 * prose (it's about to be replaced by an external HTML string at runtime); `{{ expr }}`
 * interpolations become locked placeholders, with a lock reason inferred from the expression's
 * shape, mirroring lang-jsx's `{expr}` handling.
 */

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
import type {
  AttributeNode,
  CommentNode,
  DirectiveNode,
  ElementNode,
  InterpolationNode,
  RootNode,
  TemplateChildNode,
  TextNode,
} from '@vue/compiler-core'
import { parse as parseSfc } from '@vue/compiler-sfc'
import type { AstNode } from './ast-path.ts'
import { structuralPathTo, visitNodes } from './ast-path.ts'
import { stamp } from './stamp.ts'
import { isLinear, templateTextOffsets } from './template-entities.ts'
import { vueWriter } from './writer/index.ts'

export interface VueSettings {
  /** Extra tag names treated as inline (flattened into the surrounding block). */
  extraInlineTags?: string[]
}

const NodeTypes = {
  ROOT: 0,
  ELEMENT: 1,
  TEXT: 2,
  COMMENT: 3,
  SIMPLE_EXPRESSION: 4,
  INTERPOLATION: 5,
  ATTRIBUTE: 6,
  DIRECTIVE: 7,
} as const

/** Elements that hold block-level prose, mapped to the engine's block kinds. Same vocabulary as lang-jsx/lang-html. */
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

/** Inline elements flattened into the surrounding block — same vocabulary as the other adapters. */
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
const SKIP_ELEMENTS = new Set(['script', 'style', 'code', 'pre', 'svg', 'textarea'])

/** A minimal JS expression AST node shape, enough to classify `{{ expr }}` without a Babel dep. */
interface JsExprNode {
  type: string
  callee?: { type: string; name?: string; property?: { type: string; name?: string } }
}

/** Best-effort classification of a `{{ expr }}`, mirroring lang-jsx's `lockReasonFor`. */
function lockReasonForExpr(ast: JsExprNode | null | undefined, content: string): LockReason {
  // A bare identifier ("greeting") parses to `content.ast === undefined` (no parse needed) — the
  // one case compiler-sfc special-cases rather than attaching a Babel node for.
  if (ast === undefined || ast === null) {
    return /^[$A-Za-z_][$\w.]*$/.test(content.trim()) ? 'variable' : 'expression'
  }
  switch (ast.type) {
    case 'Identifier':
    case 'MemberExpression':
    case 'OptionalMemberExpression':
      return 'variable'
    case 'TemplateLiteral':
      return 'template-literal'
    case 'CallExpression': {
      const callee = ast.callee
      if (callee?.type === 'MemberExpression' && callee.property?.name === 'map') return 'map'
      if (callee?.type === 'Identifier' && (callee.name === 't' || callee.name === '$t')) {
        return 'i18n'
      }
      return 'expression'
    }
    default:
      return 'expression'
  }
}

export interface WalkState {
  source: string
  counter: number
  uri: string
  settings: VueSettings
  root: RootNode
}

function refFor(root: RootNode, node: AstNode, type: string): NodeRef {
  const path = structuralPathTo(root as unknown as AstNode, node)
  if (path === undefined) throw new Error('refFor: node not found under the given root')
  return { path, type }
}

function isDirective(node: AttributeNode | DirectiveNode): node is DirectiveNode {
  return node.type === NodeTypes.DIRECTIVE
}

function hasVHtml(element: ElementNode): boolean {
  return element.props.some((p) => isDirective(p) && p.name === 'html')
}

function vTDirective(element: ElementNode): DirectiveNode | undefined {
  return element.props.find((p): p is DirectiveNode => isDirective(p) && p.name === 't')
}

/** Flatten one element's children into a single block, or undefined if it holds no prose. */
function buildBlock(
  element: ElementNode,
  id: string,
  kind: BlockKind,
  state: WalkState,
): Block | undefined {
  const builder = new BlockBuilder()

  const walk = (children: TemplateChildNode[]): void => {
    for (const child of children) {
      if (child.type === NodeTypes.TEXT) {
        const text = child as TextNode
        const start = text.loc.start.offset
        const end = text.loc.end.offset
        const raw = state.source.slice(start, end)
        const decoded = text.content
        if (decoded.length === 0) continue

        const offsets = templateTextOffsets(decoded, raw, start)
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

      if (child.type === NodeTypes.INTERPOLATION) {
        const interpolation = child as InterpolationNode
        const expr = interpolation.content
        const content = expr.type === NodeTypes.SIMPLE_EXPRESSION ? expr.content : ''
        const ast =
          expr.type === NodeTypes.SIMPLE_EXPRESSION
            ? (expr as unknown as { ast?: JsExprNode | null }).ast
            : undefined
        builder.addPlaceholder(interpolation.loc.start.offset, interpolation.loc.end.offset, {
          node: refFor(state.root, child as unknown as AstNode, 'interpolation'),
          lockReason: lockReasonForExpr(ast, content),
        })
        continue
      }

      if (child.type === NodeTypes.ELEMENT) {
        const element = child as ElementNode
        const name = element.tag
        if (SKIP_ELEMENTS.has(name)) continue

        if (hasVHtml(element)) {
          // v-html REPLACES this element's children entirely at runtime, so any text sitting in
          // the template source (a fallback shown only until Vue hydrates/patches) is not prose a
          // reader ever actually sees rendered from the template itself — lock it rather than
          // walking it as editable text.
          if (element.children.length > 0) {
            builder.addPlaceholder(element.loc.start.offset, element.loc.end.offset, {
              node: refFor(state.root, element as unknown as AstNode, 'element'),
              lockReason: 'html-injection',
            })
          }
          continue
        }

        if (vTDirective(element)) {
          // vue-i18n's `v-t` directive (https://vue-i18n.intlify.dev) sets the element's rendered
          // text from a translation key at runtime, same as v-html but for a string instead of
          // markup — any text sitting in the template source is unrendered fallback, not prose.
          if (element.children.length > 0) {
            builder.addPlaceholder(element.loc.start.offset, element.loc.end.offset, {
              node: refFor(state.root, element as unknown as AstNode, 'element'),
              lockReason: 'i18n',
            })
          }
          continue
        }

        const isInline =
          INLINE_ELEMENTS.has(name) || (state.settings.extraInlineTags ?? []).includes(name)
        if (isInline) {
          walk(element.children)
          continue
        }
        // A nested block-level element (a <p> inside an <li>): the outer walk over the file
        // handles it as its own block; this element contributes only a boundary here.
        builder.addBoundary()
      }

      // Comments, v-if/v-for control nodes and compound expressions are never prose text.
    }
  }

  walk(element.children)
  const { block } = builder.build({ id, kind, context: { weight: 1 } })
  return block.text.trim().length > 0 ? block : undefined
}

/**
 * Entry point `collectBlocks` uses for each block-level element: when the element ITSELF carries
 * v-html/v-t (not just a nested inline one), its children are never prose either — same locking
 * `buildBlock` already applies to a NESTED v-html/v-t element, hoisted here so a top-level
 * `<p v-html="...">` is treated identically rather than falling through to a plain text walk.
 */
function buildLockedOrTextBlock(
  element: ElementNode,
  id: string,
  kind: BlockKind,
  state: WalkState,
): Block | undefined {
  const lockReason = hasVHtml(element)
    ? 'html-injection'
    : vTDirective(element)
      ? 'i18n'
      : undefined
  if (lockReason) {
    if (element.children.length === 0) return undefined
    const builder = new BlockBuilder()
    builder.addPlaceholder(element.loc.start.offset, element.loc.end.offset, {
      node: refFor(state.root, element as unknown as AstNode, 'element'),
      lockReason,
    })
    const { block } = builder.build({ id, kind, context: { weight: 1 } })
    return block
  }
  return buildBlock(element, id, kind, state)
}

function lineOf(source: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === '\n') line++
  return line
}

function collectDirectiveComments(root: RootNode, source: string): Directive[] {
  const directives: Directive[] = []
  const visit = (node: TemplateChildNode): void => {
    if (node.type === NodeTypes.COMMENT) {
      const comment = node as CommentNode
      const directive = parseDirectiveComment(
        comment.content,
        { start: comment.loc.start.offset, end: comment.loc.end.offset },
        lineOf(source, comment.loc.start.offset),
      )
      if (directive) directives.push(directive)
      return
    }
    if (node.type === NodeTypes.ELEMENT) {
      for (const child of (node as ElementNode).children) visit(child)
    }
  }
  for (const child of root.children) visit(child)
  return directives
}

export function parseVueSfc(text: string, filename = 'Component.vue'): RootNode {
  const { descriptor, errors } = parseSfc(text, { filename })
  if (errors.length > 0) {
    throw new Error(`Vue SFC parse error: ${errors.map((e) => e.message).join('; ')}`)
  }
  if (!descriptor.template) {
    // No <template> block: an empty root, consistent with "no prose found" rather than an error —
    // a script-only .vue file (a composable, a store) is valid and simply has no markup to lint.
    return {
      type: NodeTypes.ROOT,
      source: '',
      children: [],
      loc: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 0, line: 1, column: 1 },
        source: '',
      },
    } as unknown as RootNode
  }
  if (!descriptor.template.ast) {
    throw new Error('Vue SFC parse error: <template> block produced no AST')
  }
  return descriptor.template.ast
}

export interface CollectedBlock {
  element: ElementNode
  /** Structural path of `element` itself — stable across unrelated edits, unlike a counter. */
  elementPath: string
  block: Block
}

/**
 * Every element that anchors a prose block, paired with the `Block` it produced. Shared by
 * `extract()` (which only needs the blocks) and `stamp()` (which needs the element too, to know
 * where in the source to inject `data-vf`) so the two never disagree about what counts as a block.
 */
export function collectBlocks(root: RootNode, state: WalkState): CollectedBlock[] {
  const collected: CollectedBlock[] = []
  visitNodes(root as unknown as AstNode, (node) => {
    if (node.type !== NodeTypes.ELEMENT) return
    const element = node as unknown as ElementNode
    const name = element.tag
    if (SKIP_ELEMENTS.has(name)) return
    const kind = BLOCK_ELEMENTS[name]
    if (!kind) return
    // A block element's children are flattened here; `visitNodes` still descends into them
    // afterward, since a <li> may contain its own separate <p> block. When the block element
    // itself carries v-html/v-t, its own children are never prose (see buildBlock's handling of
    // a NESTED v-html/v-t element below) — build the same locked-placeholder block here so a
    // top-level `<p v-html="...">` is treated identically to one nested deeper in the tree.
    const block = buildLockedOrTextBlock(element, `${state.uri}#${state.counter++}`, kind, state)
    if (block) {
      collected.push({
        element,
        elementPath: structuralPathTo(state.root as unknown as AstNode, node) ?? '',
        block,
      })
    }
  })
  return collected
}

function extract(text: string, context: ExtractContext): ProseDocument {
  const settings = (context.settings ?? {}) as VueSettings
  const root = parseVueSfc(text, context.uri)

  const state: WalkState = { source: text, counter: 0, uri: context.uri, settings, root }
  const blocks = collectBlocks(root, state).map(({ block }) => block)

  return {
    uri: context.uri,
    format: 'vue',
    source: text,
    blocks,
    directives: collectDirectiveComments(root, text),
  }
}

export const vueAdapter: LanguageAdapter = {
  id: 'vue',
  extensions: ['.vue'],
  extract,
  stamp,
  writer: vueWriter,
}

export default vueAdapter

export { vTDirective }
