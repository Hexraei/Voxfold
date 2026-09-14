/**
 * Writer hooks for HTML: locate a text node by its structural path, patch its decoded value, and
 * prove the rest of the tree didn't move.
 *
 * `locate()` returns the raw, uncollapsed, entity-decoded text-node value — not the
 * whitespace-collapsed text `extract` flattens into a block. That collapsing exists to score text
 * the way a browser renders it; the writer edits the actual source text a node holds, which is a
 * different (and simpler) question: what's really there, byte for byte.
 */

import type { AdapterWriter, LocatedNode, NodeRef } from '@voxfold/core'
import { type DefaultTreeAdapterTypes, parse } from 'parse5'
import { encodeHtmlText } from './encode.ts'

type ChildNode = DefaultTreeAdapterTypes.ChildNode
type Document = DefaultTreeAdapterTypes.Document
type Element = DefaultTreeAdapterTypes.Element
type TextNode = DefaultTreeAdapterTypes.TextNode

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node
}

function isText(node: ChildNode): node is TextNode {
  return node.nodeName === '#text'
}

function nodeAtPath(root: Document, path: string): ChildNode {
  const segments = path.split('.').map(Number)
  let node: ChildNode = root.childNodes[segments[0]!]!
  for (let i = 1; i < segments.length; i++) {
    if (!isElement(node)) {
      throw new Error(`path "${path}": segment ${i} has no children, node is a #${node.nodeName}`)
    }
    const child = node.childNodes[segments[i]!]
    if (!child) throw new Error(`path "${path}": no child at index ${segments[i]}`)
    node = child
  }
  return node
}

/**
 * Map each character of a decoded text value back to the source offset of the raw byte(s) that
 * produced it — identical in spirit to `collapseWhitespace` in `../index.ts`, but without
 * collapsing: every character of `value`, including whitespace runs, keeps its own source offset.
 */
function charMapFor(value: string, raw: string, start: number): Int32Array | undefined {
  const offsets = new Int32Array(value.length)
  let rawIndex = 0
  let nonLinear = false

  for (let i = 0; i < value.length; i++) {
    if (raw[rawIndex] === '&') {
      const semicolon = raw.indexOf(';', rawIndex)
      if (semicolon !== -1 && semicolon - rawIndex <= 10) {
        offsets[i] = start + rawIndex
        rawIndex = semicolon + 1
        nonLinear = true
        continue
      }
    }
    // The parser normalizes CRLF to \n in text values; the source consumed two characters.
    if (value[i] === '\n' && raw[rawIndex] === '\r' && raw[rawIndex + 1] === '\n') {
      offsets[i] = start + rawIndex
      rawIndex += 2
      nonLinear = true
      continue
    }
    offsets[i] = start + rawIndex
    rawIndex++
  }

  return nonLinear ? offsets : undefined
}

function locate(ast: Document, ref: NodeRef, source: string): LocatedNode {
  const node = nodeAtPath(ast, ref.path)
  const nodeType = isText(node) ? '#text' : isElement(node) ? node.tagName : node.nodeName
  if (nodeType !== ref.type) {
    throw new Error(`path "${ref.path}": expected a ${ref.type}, found a ${nodeType}`)
  }
  if (!isText(node)) {
    throw new Error(`path "${ref.path}": ${nodeType} is not an editable text node`)
  }
  const location = node.sourceCodeLocation
  if (!location) throw new Error(`path "${ref.path}": node has no source location`)

  const raw = source.slice(location.startOffset, location.endOffset)
  const charMap = charMapFor(node.value, raw, location.startOffset)

  return {
    valueRange: { start: location.startOffset, end: location.endOffset },
    decoded: node.value,
    ...(charMap ? { charMap } : {}),
    nodeType: '#text',
  }
}

/**
 * Structure without positions or the masked nodes' own text: every other node's tag/type and
 * child count, in document order.
 */
function fingerprint(ast: Document, maskedRefs: readonly NodeRef[]): string {
  const maskedPaths = new Set(maskedRefs.map((ref) => ref.path))
  const parts: string[] = []

  const visit = (node: ChildNode, path: string): void => {
    if (maskedPaths.has(path)) {
      parts.push(`${path}:*`)
      return
    }
    if (isText(node)) {
      parts.push(`${path}:#text:${node.value}`)
      return
    }
    if (isElement(node)) {
      parts.push(`${path}:${node.tagName}`)
      node.childNodes.forEach((child, index) => {
        visit(child, `${path}.${index}`)
      })
      return
    }
    parts.push(`${path}:${node.nodeName}`)
  }

  ast.childNodes.forEach((child, index) => {
    visit(child, String(index))
  })
  return parts.join('|')
}

/**
 * `AdapterWriter.locate`/`fingerprint` need the raw source text to build a charMap and slice raw
 * bytes, but the shared interface only passes the parsed `ast` and a `ref`. parse5's tree doesn't
 * retain the source string itself, so this wraps the parsed document together with the text it
 * came from — `parse` below is the only place that combines them.
 */
interface HtmlAst {
  document: Document
  source: string
}

export const htmlWriter: AdapterWriter<HtmlAst> = {
  parse: (text) => ({ document: parse(text, { sourceCodeLocationInfo: true }), source: text }),
  locate: (ast, ref) => locate(ast.document, ref, ast.source),
  encode: encodeHtmlText,
  fingerprint: (ast, maskedRefs) => fingerprint(ast.document, maskedRefs),
}
