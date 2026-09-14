/**
 * Writer hooks for JSX/TSX: locate a text node by the structural `NodeRef` extract() already
 * stamps on every editable segment, patch its decoded value, and prove the rest of the tree
 * didn't move.
 *
 * `NodeRef.path` is a structural (sibling-index) path from the Program root — same idea as
 * markdown/HTML's `NodeRef`s, computed by `../ast-path.ts` — rather than a source-position pair.
 * A position pair is exact within one parse, but the writer needs to identify "the same logical
 * node" across TWO parses (before and after a patch), and any edit that changes the patched
 * text's length shifts every later node's position — a structural path has no such problem, since
 * it depends only on the tree's shape.
 */

import type { Node as BabelNode, File, JSXText, StringLiteral } from '@babel/types'
import type { AdapterWriter, LocatedNode, NodeRef } from '@voxfold/core'
import { nodeAtStructuralPath } from '../ast-path.ts'
import { parseJsx } from '../index.ts'
import { decodeStringLiteral } from '../js-string-literal.ts'
import { jsxTextOffsets } from '../jsx-entities.ts'
import { cleanJsxTextWithOffsets } from '../jsx-whitespace.ts'
import { encodeJsxText, encodeStringLiteral } from './encode.ts'

/** `refFor(node, "StringLiteral:'")` → the real Babel node type is just `"StringLiteral"`. */
function babelTypeOf(refType: string): string {
  return refType.split(':')[0]!
}

function programOf(file: File): BabelNode {
  return file.program as unknown as BabelNode
}

function locate(ast: { file: File; source: string }, ref: NodeRef): LocatedNode {
  const node = nodeAtStructuralPath(programOf(ast.file), ref.path)
  if (!node) throw new Error(`no node at structural path "${ref.path}"`)
  const expectedType = babelTypeOf(ref.type)
  if (node.type !== expectedType) {
    throw new Error(`node at "${ref.path}" is a ${node.type}, expected ${expectedType}`)
  }

  if (node.type === 'JSXText') {
    const text = node as JSXText
    const raw = ast.source.slice(text.start!, text.end!)
    const entityOffsets = jsxTextOffsets(text.value, raw, text.start!)
    const cleaned = cleanJsxTextWithOffsets(text.value, entityOffsets)
    return {
      valueRange: { start: text.start!, end: text.end! },
      decoded: cleaned.text,
      charMap: cleaned.offsets,
      nodeType: 'JSXText',
    }
  }

  if (node.type === 'StringLiteral') {
    const literal = node as StringLiteral
    const raw = ast.source.slice(literal.start!, literal.end!)
    const decoded = decodeStringLiteral(raw)
    const charMap = Int32Array.from(decoded.offsets, (o) => literal.start! + o)
    return {
      valueRange: { start: literal.start!, end: literal.end! },
      decoded: decoded.value,
      charMap,
      // The quote travels through nodeType, matching how refFor stamped it at extract time, so
      // `encode` below can pick the right escape rules without LocatedNode needing a JSX field.
      nodeType: `StringLiteral:${decoded.quote}`,
    }
  }

  throw new Error(`node type "${node.type}" is not an editable text node`)
}

/**
 * Structure without positions or the masked nodes' own text: every node's type, keyed by its
 * structural path — a `NodeRef.path` from extract() IS this path already, so masking here is a
 * direct set-membership check, unlike a position-based scheme where the "after" tree's offsets
 * would never match the original ones.
 */
function fingerprint(ast: { file: File; source: string }, maskedRefs: readonly NodeRef[]): string {
  const maskedPaths = new Set(maskedRefs.map((ref) => ref.path))
  const parts: string[] = []
  const root = programOf(ast.file)

  // visitNodes doesn't report a node's own structural path, so paths are computed once via a
  // parallel walk that mirrors it exactly (same key/array iteration order), building the path
  // incrementally rather than re-deriving it from the root for every node.
  const visit = (node: BabelNode, path: string): void => {
    const masked = maskedPaths.has(path)
    if (masked) {
      parts.push(`${path}:${node.type}:*`)
    } else if (node.type === 'JSXText') {
      parts.push(`${path}:JSXText:${(node as JSXText).value}`)
    } else if (node.type === 'StringLiteral') {
      parts.push(`${path}:StringLiteral:${(node as StringLiteral).value}`)
    } else {
      parts.push(`${path}:${node.type}`)
    }

    for (const key of Object.keys(node)) {
      if (['loc', 'start', 'end', 'range', 'extra'].includes(key)) continue
      const value = (node as unknown as Record<string, unknown>)[key]
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          if (item && typeof item === 'object' && 'type' in item) {
            visit(item as BabelNode, path ? `${path}.${key}[${index}]` : `${key}[${index}]`)
          }
        })
      } else if (value && typeof value === 'object' && 'type' in value) {
        visit(value as BabelNode, path ? `${path}.${key}` : key)
      }
    }
  }

  visit(root, '')
  return parts.join('|')
}

function encode(newDecoded: string, located: LocatedNode): string {
  if (located.nodeType === 'JSXText') return encodeJsxText(newDecoded)
  if (located.nodeType.startsWith('StringLiteral:')) {
    const quote = located.nodeType.slice('StringLiteral:'.length)
    return encodeStringLiteral(newDecoded, quote)
  }
  throw new Error(`no encoder for node type "${located.nodeType}"`)
}

export const jsxWriter: AdapterWriter<{ file: File; source: string }> = {
  parse: (text) => ({ file: parseJsx(text), source: text }),
  locate,
  encode,
  fingerprint,
}
