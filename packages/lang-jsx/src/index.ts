/**
 * JSX/TSX adapter.
 *
 * Walks a Babel AST rather than running regexes over source, so prose that spans
 * `<strong>doesn't just</strong>` is one flat string to the engine, offsets stay exact, and JSX's
 * actual whitespace rendering rules (not a generic HTML approximation) decide what text a reader
 * would really see.
 *
 * Only HOST elements (lowercase tag names: `p`, `li`, `strong`, …) ever hold prose. A capitalized
 * tag is a component; its children are that component's own concern; if the JSX being linted
 * renders it, whatever prose lives inside IT is linted when that component's own file is linted,
 * not twice. `{expr}` becomes a locked placeholder, with a lock reason inferred from the
 * expression's shape — `.map(...)` calls, bare identifiers, template literals and i18n helpers
 * each get a distinct reason so the (future) overlay's badge can say something specific rather
 * than a generic "can't edit here."
 */

import { parse } from '@babel/parser'
import type {
  Node as BabelNode,
  Comment,
  Expression,
  File,
  JSXElement,
  JSXExpressionContainer,
  JSXFragment,
} from '@babel/types'
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
import { structuralPathTo, visitNodes } from './ast-path.ts'
import { decodeStringLiteral } from './js-string-literal.ts'
import { jsxTextOffsets } from './jsx-entities.ts'
import { cleanJsxTextWithOffsets } from './jsx-whitespace.ts'
import { stamp } from './stamp.ts'
import { jsxWriter } from './writer/index.ts'

export interface JsxSettings {
  /** Extra host tag names treated as inline (flattened into the surrounding block). */
  extraInlineTags?: string[]
}

/** Host elements that hold block-level prose, mapped to the engine's block kinds. */
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

/** Inline host elements flattened into the surrounding block — same vocabulary as the HTML adapter. */
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

/** Host elements whose content is never prose. */
const SKIP_ELEMENTS = new Set(['script', 'style', 'code', 'pre', 'svg', 'textarea'])

function isHostElement(name: string): boolean {
  return /^[a-z]/.test(name)
}

function tagNameOf(element: JSXElement): string | undefined {
  const name = element.openingElement.name
  return name.type === 'JSXIdentifier' ? name.name : undefined
}

/** Best-effort classification of an `{expr}` for the overlay's "why can't I edit this" badge. */
function lockReasonFor(expression: Expression | { type: 'JSXEmptyExpression' }): LockReason {
  switch (expression.type) {
    case 'Identifier':
      return 'variable'
    case 'TemplateLiteral':
      return 'template-literal'
    case 'MemberExpression':
    case 'OptionalMemberExpression':
      return 'variable'
    case 'CallExpression': {
      const callee = expression.callee
      if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
        if (callee.property.name === 'map') return 'map'
      }
      if (callee.type === 'Identifier' && (callee.name === 't' || callee.name === 'i18n')) {
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
  settings: JsxSettings
  root: BabelNode
}

function refFor(root: BabelNode, node: BabelNode, type: string): NodeRef {
  // A structural (sibling-index) path, like markdown/HTML use — not `${start}-${end}` — because
  // the writer needs to find the SAME logical node again after a reparse whose positions have all
  // shifted (any edit changes the length of the patched text, moving every later offset). A
  // structural path depends only on the tree's shape, which is unaffected by that.
  const path = structuralPathTo(root, node)
  if (path === undefined) throw new Error(`refFor: node not found under the given root`)
  return { path, type }
}

/** Flatten one JSX host element's children into a single block, or undefined if it holds no prose. */
function buildBlock(
  element: JSXElement,
  id: string,
  kind: BlockKind,
  state: WalkState,
): Block | undefined {
  const builder = new BlockBuilder()

  const walk = (
    children: (JSXElement | JSXFragment | JSXExpressionContainer | BabelNode)[],
  ): void => {
    for (const child of children) {
      if (child.type === 'JSXText') {
        // Babel already HTML-entity-decodes JSXText into `child.value`, so the source offset of
        // each decoded character is not simply `child.start + i` whenever an entity appears
        // (`&amp;` is 5 source characters for 1 decoded one). Map decoded-value offsets back to
        // the raw source FIRST, then run React's own whitespace-cleaning algorithm on top of
        // that, composing the two so the final charMap points at real source positions
        // regardless of which (or both) transformations touched a given character.
        const rawSlice = state.source.slice(child.start!, child.end!)
        const entityOffsets = jsxTextOffsets(child.value, rawSlice, child.start!)
        const cleaned = cleanJsxTextWithOffsets(child.value, entityOffsets)
        if (cleaned.text.length === 0) continue

        const isLinear = cleaned.offsets.every(
          (o, i) => i === 0 || o === cleaned.offsets[i - 1]! + 1,
        )
        if (isLinear) {
          builder.addText(
            cleaned.text,
            cleaned.offsets[0]!,
            cleaned.offsets[0]! + cleaned.text.length,
            {
              node: refFor(state.root, child, 'JSXText'),
            },
          )
        } else {
          builder.addText(cleaned.text, child.start!, child.end!, {
            charMap: cleaned.offsets,
            node: refFor(state.root, child, 'JSXText'),
          })
        }
        continue
      }

      if (child.type === 'JSXExpressionContainer') {
        if (child.expression.type === 'StringLiteral') {
          // `{"literal text"}` reads as prose to a viewer; edit it like any other text. The
          // literal's raw source includes its quotes and any JS escapes (\", \n, \uXXXX, …), both
          // of which make the decoded value's length differ from the source span — same shape of
          // problem as JSX entities, solved the same way: decode with an offset for every char.
          const literal = child.expression
          const raw = state.source.slice(literal.start!, literal.end!)
          const decoded = decodeStringLiteral(raw)
          if (decoded.value.length > 0) {
            const charMap = Int32Array.from(decoded.offsets, (o) => literal.start! + o)
            builder.addText(decoded.value, literal.start!, literal.end!, {
              charMap,
              // The quote character travels inside the ref type so the writer's `encode` can
              // match it later without LocatedNode needing a JSX-specific field.
              node: refFor(state.root, literal, `StringLiteral:${decoded.quote}`),
            })
          }
          continue
        }
        builder.addPlaceholder(child.start!, child.end!, {
          node: refFor(state.root, child, 'JSXExpressionContainer'),
          lockReason: lockReasonFor(child.expression),
        })
        continue
      }

      if (child.type === 'JSXElement') {
        const name = tagNameOf(child)
        if (!name) {
          builder.addPlaceholder(child.start!, child.end!, {
            node: refFor(state.root, child, 'JSXElement'),
            lockReason: 'unknown',
          })
          continue
        }
        if (SKIP_ELEMENTS.has(name)) continue
        const isInline =
          INLINE_ELEMENTS.has(name) || (state.settings.extraInlineTags ?? []).includes(name)
        if (isHostElement(name) && isInline) {
          walk(child.children as (JSXElement | JSXFragment | JSXExpressionContainer | BabelNode)[])
          continue
        }
        // A non-inline host or a component: not prose text inside THIS block. If it's a nested
        // block-level host (a <p> inside an <li>), the outer walk over the file handles it as its
        // own block; a component's children are the component's own concern, never linted here.
        builder.addBoundary()
        continue
      }

      if (child.type === 'JSXFragment') {
        walk(child.children as (JSXElement | JSXFragment | JSXExpressionContainer | BabelNode)[])
      }
    }
  }

  walk(element.children as (JSXElement | JSXFragment | JSXExpressionContainer | BabelNode)[])
  const { block } = builder.build({ id, kind, context: { weight: 1 } })
  return block.text.trim().length > 0 ? block : undefined
}

function collectDirectives(comments: readonly Comment[], source: string): Directive[] {
  const lineOf = (offset: number): number => {
    let line = 1
    for (let i = 0; i < offset && i < source.length; i++) if (source[i] === '\n') line++
    return line
  }
  const directives: Directive[] = []
  for (const comment of comments) {
    const directive = parseDirectiveComment(
      comment.value,
      { start: comment.start!, end: comment.end! },
      lineOf(comment.start!),
    )
    if (directive) directives.push(directive)
  }
  return directives
}

export function parseJsx(text: string): File {
  return parse(text, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
    errorRecovery: false,
  })
}

export interface CollectedBlock {
  element: JSXElement
  /** Structural path of `element` itself — stable across unrelated edits, unlike a counter. */
  elementPath: string
  block: Block
}

/**
 * Every host element that anchors a prose block, paired with the `Block` it produced. Shared by
 * `extract()` (which only needs the blocks) and `stamp()` (which needs the element too, to know
 * where in the source to inject `data-vf`) so the two never disagree about what counts as a block.
 */
export function collectBlocks(root: BabelNode, state: WalkState): CollectedBlock[] {
  const collected: CollectedBlock[] = []
  visitNodes(root, (node) => {
    if (node.type !== 'JSXElement') return
    const name = tagNameOf(node)
    if (!name || SKIP_ELEMENTS.has(name)) return
    const kind = BLOCK_ELEMENTS[name]
    if (!kind || !isHostElement(name)) return
    // A block element's children are flattened into it here; `visitNodes` still descends into
    // them afterward, since a <li> may contain its own separate <p> block.
    const block = buildBlock(node, `${state.uri}#${state.counter++}`, kind, state)
    if (block) {
      collected.push({
        element: node,
        elementPath: structuralPathTo(state.root, node) ?? '',
        block,
      })
    }
  })
  return collected
}

function extract(text: string, context: ExtractContext): ProseDocument {
  const settings = (context.settings ?? {}) as JsxSettings
  const ast = parseJsx(text)
  const root = ast.program as unknown as BabelNode

  const state: WalkState = { source: text, counter: 0, uri: context.uri, settings, root }

  const blocks = collectBlocks(root, state).map(({ block }) => block)

  return {
    uri: context.uri,
    format: 'jsx',
    source: text,
    blocks,
    directives: collectDirectives(ast.comments ?? [], text),
  }
}

export const jsxAdapter: LanguageAdapter = {
  id: 'jsx',
  extensions: ['.jsx', '.tsx'],
  extract,
  stamp,
  writer: jsxWriter,
}

export default jsxAdapter
