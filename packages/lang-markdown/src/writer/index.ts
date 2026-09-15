/**
 * Writer hooks for markdown/MDX: locate a text node by its structural path, patch its decoded
 * value, and prove the rest of the tree didn't move.
 *
 * Only `text` nodes are ever targets: extract's `NodeRef`s for prose always point at a `text`
 * node (see `../index.ts`'s `buildBlock`), since that's the only node type whose value is
 * editable prose rather than markup structure.
 */

import type { AdapterWriter, LocatedNode, NodeRef } from '@voxfold/core'
import type { Nodes, Parents, RootContent } from 'mdast'
import { mapEscapes, parseMarkdown } from '../index.ts'
import { encodeMarkdownText } from './encode.ts'

function isParent(node: Nodes): node is Parents {
  return 'children' in node && Array.isArray((node as Parents).children)
}

/** Walk a root-relative dot-joined index path (see `pathOf` in `../index.ts`) down to a node. */
function nodeAtPath(root: Nodes, path: string): Nodes {
  if (path === '') return root
  let node: Nodes = root
  for (const segment of path.split('.')) {
    const index = Number(segment)
    if (!isParent(node)) {
      throw new Error(`path "${path}": "${segment}" has no children, node is a ${node.type}`)
    }
    const child = (node.children as RootContent[])[index]
    if (!child) throw new Error(`path "${path}": no child at index ${index}`)
    node = child as Nodes
  }
  return node
}

/**
 * `AdapterWriter.locate`/`fingerprint` need the raw source text to build a charMap for escaped
 * characters (`\*` → `*`), but the shared interface only passes the parsed `ast` and a `ref`.
 * mdast's tree doesn't retain the source string itself, so this wraps the parsed tree together
 * with the text it came from — same pattern as `lang-html`'s `HtmlAst`.
 */
export interface MarkdownAst {
  root: Nodes
  source: string
}

function locate(ast: MarkdownAst, ref: NodeRef): LocatedNode {
  const node = nodeAtPath(ast.root, ref.path)
  if (node.type !== ref.type) {
    throw new Error(`path "${ref.path}": expected a ${ref.type}, found a ${node.type}`)
  }
  if (node.type !== 'text' || !('value' in node)) {
    throw new Error(`path "${ref.path}": ${node.type} is not an editable text node`)
  }
  const position = node.position
  const start = position?.start.offset
  const end = position?.end.offset
  if (start === undefined || end === undefined) {
    throw new Error(`path "${ref.path}": node has no position information`)
  }

  const value = (node as { value: string }).value
  // The raw slice may contain escapes (`\*`) that the parsed value does not, so `end - start` can
  // be WIDER than `value.length` — a charMap is required whenever that happens, the same gap
  // extract()'s `buildBlock` already accounts for via this same `mapEscapes` helper. Missing this
  // is a real bug this exact spike caught: `locate()` previously always reported a linear range,
  // which the writer protocol correctly rejected (`OutOfBounds`) the moment a target text node's
  // raw source contained any escape sequence at all.
  const raw = ast.source.slice(start, end)
  if (raw === value) {
    return { valueRange: { start, end }, decoded: value, nodeType: node.type }
  }
  const charMap = mapEscapes(raw, value, start)
  return { valueRange: { start, end }, decoded: value, charMap, nodeType: node.type }
}

/**
 * Structure without positions or the masked nodes' own text: every other node's type and child
 * count, in document order. Two trees with the same fingerprint differ, if at all, only in the
 * decoded value of the masked text nodes — exactly what an edit is allowed to change.
 */
function fingerprint(ast: MarkdownAst, maskedRefs: readonly NodeRef[]): string {
  const maskedPaths = new Set(maskedRefs.map((ref) => ref.path))
  const parts: string[] = []

  const visit = (node: Nodes, path: string): void => {
    if (maskedPaths.has(path)) {
      parts.push(`${path}:${node.type}:*`)
      return
    }
    if (node.type === 'text' && 'value' in node) {
      parts.push(`${path}:text:${(node as { value: string }).value}`)
      return
    }
    parts.push(`${path}:${node.type}`)
    if (isParent(node)) {
      node.children.forEach((child, index) => {
        visit(child as Nodes, path ? `${path}.${index}` : String(index))
      })
    }
  }

  visit(ast.root, '')
  return parts.join('|')
}

export const markdownWriter: AdapterWriter<MarkdownAst> = {
  // Always parsed with MDX extensions on, regardless of whether this particular file is .md or
  // .mdx: MDX syntax is additive (JSX, {expr}, imports), so an ordinary markdown file produces an
  // identical tree either way, and a NodeRef's path (computed by extract, which does branch on
  // the file's actual mode) resolves correctly against either parse. This sidesteps `parse`
  // having no filename to detect MDX from — only `text: string` per the shared `AdapterWriter`
  // contract, which is deliberately format-agnostic.
  parse: (text) => ({ root: parseMarkdown(text, { mdx: true }), source: text }),
  locate,
  encode: encodeMarkdownText,
  fingerprint,
}
