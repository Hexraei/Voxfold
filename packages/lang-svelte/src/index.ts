/**
 * Svelte adapter.
 *
 * Walks `svelte/compiler`'s modern template AST rather than running regexes over source, so prose
 * that spans `<strong>doesn't just</strong>` is one flat string to the engine and offsets stay
 * exact. Same overall shape as `@voxfold/lang-vue`, with three format-specific differences below.
 *
 * SVELTE 4 VS SVELTE 5 AST: `svelte/compiler`'s `parse()` returns one of two DIFFERENT node
 * shapes for the SAME source, controlled entirely by the `modern` option — NOT by which syntax
 * version the source itself uses. `modern: false` (the default) returns the legacy AST
 * (`ast.html.children`, node types `Element`/`MustacheTag`/`RawMustacheTag`/`EventHandler`).
 * `modern: true` returns the new AST (`ast.fragment.nodes`, node types
 * `RegularElement`/`ExpressionTag`/`HtmlTag`/`OnDirective`). Verified empirically: parsing
 * Svelte-4-flavored source (`on:click`, `{#each}`, `export let`, no runes) with `modern: true`
 * on svelte@5.57.0 produces the SAME modern shape as Svelte-5-flavored (runes) source — the
 * single 5.x compiler parses both syntax generations fine, and `modern: true` normalizes BOTH to
 * one shape. So this adapter always parses with `modern: true` and has exactly one code path;
 * there is no legacy-AST branch to maintain, and no Svelte-4-vs-5 detection needed at all — only
 * the "which AST shape did svelte/compiler.parse() give me" choice needed detecting/verifying,
 * and it's a static option, not something to infer from the file.
 *
 * OFFSET SPIKE RESULT: `AST.Root`/`Fragment` node `start`/`end` (and `Text.start`/`.end`) are
 * relative to the WHOLE FILE, same as Vue's `descriptor.template.ast` — verified empirically:
 * parsing `<p>Hello {name}, welcome to the site.</p>` after a `<script>` block, the `Text` node
 * inside `<p>` reported `start` equal to `source.indexOf('Hello')` with no adjustment needed
 * (Svelte files have no separate `<template>` wrapper the way Vue SFCs do, so there was never a
 * second coordinate space to reconcile in the first place — `<script>`/`<style>` are their own
 * top-level `instance`/`module`/`css` fields on `AST.Root`, disjoint from `fragment.nodes`).
 *
 * WHITESPACE: unlike Vue's `condense: true` default, `svelte/compiler` does NOT collapse
 * whitespace inside `Text` nodes — verified empirically (see `template-entities.ts`). Only HTML
 * entity decoding is non-linear here.
 *
 * `{@html ...}` locks the containing block (Svelte's `v-html` equivalent). `{expr}`
 * (`ExpressionTag`) becomes a locked placeholder, lock reason inferred from the expression shape.
 * Text inside `{#each}` bodies is locked as `map`, matching how lang-jsx treats `.map()`-rendered
 * text and per the build plan.
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
import type { AST } from 'svelte/compiler'
import { parse as parseSvelte } from 'svelte/compiler'
import type { AstNode } from './ast-path.ts'
import { structuralPathTo } from './ast-path.ts'
import { stamp } from './stamp.ts'
import { isLinear, templateTextOffsets } from './template-entities.ts'
import { svelteWriter } from './writer/index.ts'

export interface SvelteSettings {
  /** Extra tag names treated as inline (flattened into the surrounding block). */
  extraInlineTags?: string[]
}

/** Elements that hold block-level prose, mapped to the engine's block kinds. Same vocabulary as lang-vue/lang-jsx. */
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

/** Elements whose content is never prose. `<script>`/`<style>` never appear in `fragment.nodes`
 * at all (they're `Root.instance`/`.module`/`.css`), so only markup-only skip tags are needed. */
const SKIP_ELEMENTS = new Set(['code', 'pre', 'svg', 'textarea'])

/** A minimal JS expression AST node shape, enough to classify `{expr}` without a full Espree dep. */
interface JsExprNode {
  type: string
  name?: string
  callee?: { type: string; name?: string; property?: { type: string; name?: string } }
}

/** Best-effort classification of a `{expr}`, mirroring lang-vue's `lockReasonForExpr`. */
function lockReasonForExpr(ast: JsExprNode): LockReason {
  switch (ast.type) {
    case 'Identifier':
    case 'MemberExpression':
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
  settings: SvelteSettings
  root: AST.Root
}

function refFor(root: AST.Root, node: AstNode, type: string): NodeRef {
  const path = structuralPathTo(root as unknown as AstNode, node)
  if (path === undefined) throw new Error('refFor: node not found under the given root')
  return { path, type }
}

type ElementNode = AST.RegularElement
type FragmentChild = AST.Fragment['nodes'][number]

function isElement(node: FragmentChild): node is ElementNode {
  return node.type === 'RegularElement'
}

function isText(node: FragmentChild): node is AST.Text {
  return node.type === 'Text'
}

function isExpressionTag(node: FragmentChild): node is AST.ExpressionTag {
  return node.type === 'ExpressionTag'
}

function isHtmlTag(node: FragmentChild): node is AST.HtmlTag {
  return node.type === 'HtmlTag'
}

function isEachBlock(node: FragmentChild): node is AST.EachBlock {
  return node.type === 'EachBlock'
}

function isIfBlock(node: FragmentChild): node is AST.IfBlock {
  return node.type === 'IfBlock'
}

function isComment(node: FragmentChild): node is AST.Comment {
  return node.type === 'Comment'
}

/**
 * Walk a Fragment's nodes, appending text/placeholders to `builder`. `locked`, when set, means
 * every Text encountered anywhere below (however deeply nested through further elements) becomes
 * a locked placeholder rather than editable text — used for `{#each}` bodies, per the build plan
 * (text rendered from a `.map()`-like construct is not directly editable prose), same treatment
 * lang-jsx gives `.map()`-rendered JSX children.
 */
function walkFragment(
  nodes: readonly FragmentChild[],
  builder: BlockBuilder,
  state: WalkState,
  locked: LockReason | undefined,
): void {
  for (const child of nodes) {
    if (isText(child)) {
      if (child.data.length === 0) continue
      if (locked) {
        builder.addPlaceholder(child.start, child.end, {
          node: refFor(state.root, child as unknown as AstNode, 'text'),
          lockReason: locked,
        })
        continue
      }
      const raw = state.source.slice(child.start, child.end)
      const decoded = child.data
      const offsets = templateTextOffsets(decoded, raw, child.start)
      if (isLinear(offsets)) {
        builder.addText(decoded, offsets[0]!, offsets[0]! + decoded.length, {
          node: refFor(state.root, child as unknown as AstNode, 'text'),
        })
      } else {
        builder.addText(decoded, child.start, child.end, {
          charMap: offsets,
          node: refFor(state.root, child as unknown as AstNode, 'text'),
        })
      }
      continue
    }

    if (isExpressionTag(child)) {
      builder.addPlaceholder(child.start, child.end, {
        node: refFor(state.root, child as unknown as AstNode, 'expression-tag'),
        lockReason: locked ?? lockReasonForExpr(child.expression as unknown as JsExprNode),
      })
      continue
    }

    if (isHtmlTag(child)) {
      // {@html ...} REPLACES this position's content entirely at runtime — never prose text.
      builder.addPlaceholder(child.start, child.end, {
        node: refFor(state.root, child as unknown as AstNode, 'html-tag'),
        lockReason: 'html-injection',
      })
      continue
    }

    if (isEachBlock(child)) {
      // Per the build plan: text rendered inside a {#each} body is locked as 'map', same as
      // JSX's .map()-rendered children — it's driven by iteration, not a fixed authored string.
      walkFragment(child.body.nodes, builder, state, 'map')
      if (child.fallback) walkFragment(child.fallback.nodes, builder, state, locked)
      continue
    }

    if (isIfBlock(child)) {
      // {#if}/{:else} branches are still statically-authored prose (just conditionally shown),
      // unlike {#each} — so they're walked normally rather than locked, consistent with how
      // lang-jsx treats a ternary/&&-guarded JSX branch as ordinary editable text.
      walkFragment(child.consequent.nodes, builder, state, locked)
      if (child.alternate) walkFragment(child.alternate.nodes, builder, state, locked)
      continue
    }

    if (isComment(child)) continue

    if (isElement(child)) {
      const name = child.name
      if (SKIP_ELEMENTS.has(name)) continue

      const isInline =
        INLINE_ELEMENTS.has(name) || (state.settings.extraInlineTags ?? []).includes(name)
      if (isInline) {
        walkFragment(child.fragment.nodes, builder, state, locked)
        continue
      }
      // A nested block-level element (a <p> inside an <li>): the outer walk over the file
      // handles it as its own block; this element contributes only a boundary here.
      builder.addBoundary()
    }
  }
}

/** Flatten one element's children into a single block, or undefined if it holds no prose.
 * `inherited` is set when `element` itself sits inside a {#each} body (see `collectBlocks`),
 * so e.g. a <li> nested directly under {#each} locks its own text as 'map' too, not just an
 * {expr} that would otherwise classify some other way. */
function buildBlock(
  element: ElementNode,
  id: string,
  kind: BlockKind,
  state: WalkState,
  inherited: LockReason | undefined,
): Block | undefined {
  const builder = new BlockBuilder()
  walkFragment(element.fragment.nodes, builder, state, inherited)
  const { block } = builder.build({ id, kind, context: { weight: 1 } })
  return block.text.trim().length > 0 ? block : undefined
}

function lineOf(source: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === '\n') line++
  return line
}

function collectDirectiveComments(root: AST.Root, source: string): Directive[] {
  const directives: Directive[] = []
  const visit = (node: FragmentChild): void => {
    if (isComment(node)) {
      const directive = parseDirectiveComment(
        node.data,
        { start: node.start, end: node.end },
        lineOf(source, node.start),
      )
      if (directive) directives.push(directive)
      return
    }
    if (isElement(node)) {
      for (const child of node.fragment.nodes) visit(child)
    } else if (isEachBlock(node)) {
      for (const child of node.body.nodes) visit(child)
      if (node.fallback) for (const child of node.fallback.nodes) visit(child)
    } else if (isIfBlock(node)) {
      for (const child of node.consequent.nodes) visit(child)
      if (node.alternate) for (const child of node.alternate.nodes) visit(child)
    }
  }
  for (const child of root.fragment.nodes) visit(child)
  return directives
}

export function parseSvelteFile(text: string, _filename = 'Component.svelte'): AST.Root {
  // `modern: true` is the only AST shape this adapter ever asks for — see the module doc comment
  // for why that's sufficient for both Svelte 4- and 5-flavored source under svelte@5.x.
  return parseSvelte(text, { modern: true })
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
export function collectBlocks(root: AST.Root, state: WalkState): CollectedBlock[] {
  const collected: CollectedBlock[] = []

  // A dedicated walk (rather than the generic visitNodes) because block-anchor discovery needs
  // to know whether it is currently inside a {#each} BODY specifically (not a {#if} branch, not
  // an {#each} fallback) — every element found there locks its own text as 'map', same as a <li>
  // sitting directly under {#each} in the extract test above.
  const visit = (nodes: readonly FragmentChild[], inherited: LockReason | undefined): void => {
    for (const node of nodes) {
      if (isElement(node)) {
        const name = node.name
        if (!SKIP_ELEMENTS.has(name)) {
          const kind = BLOCK_ELEMENTS[name]
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
          // Still descend: a block element may itself contain further nested block elements
          // (a <p> inside an <li>), same as lang-vue's collectBlocks.
          visit(node.fragment.nodes, inherited)
        }
      } else if (isEachBlock(node)) {
        visit(node.body.nodes, 'map')
        if (node.fallback) visit(node.fallback.nodes, inherited)
      } else if (isIfBlock(node)) {
        visit(node.consequent.nodes, inherited)
        if (node.alternate) visit(node.alternate.nodes, inherited)
      }
      // Text/ExpressionTag/HtmlTag/Comment nodes hold no further element descendants.
    }
  }

  visit(root.fragment.nodes, undefined)
  return collected
}

function extract(text: string, context: ExtractContext): ProseDocument {
  const settings = (context.settings ?? {}) as SvelteSettings
  const root = parseSvelteFile(text, context.uri)

  const state: WalkState = { source: text, counter: 0, uri: context.uri, settings, root }
  const blocks = collectBlocks(root, state).map(({ block }) => block)

  return {
    uri: context.uri,
    format: 'svelte',
    source: text,
    blocks,
    directives: collectDirectiveComments(root, text),
  }
}

export const svelteAdapter: LanguageAdapter = {
  id: 'svelte',
  extensions: ['.svelte'],
  extract,
  stamp,
  writer: svelteWriter,
}

export default svelteAdapter
