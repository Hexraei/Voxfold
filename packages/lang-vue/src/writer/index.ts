/**
 * Writer hooks for Vue SFCs: locate a template text node by the structural `NodeRef` extract()
 * already stamps on every editable segment, patch its decoded value, and prove the rest of the
 * tree didn't move.
 *
 * `NodeRef.path` is a structural (sibling-index) path from the template root — same idea as
 * lang-jsx's Babel-tree paths, computed by `../ast-path.ts` — rather than a source-position pair,
 * since the writer needs to identify "the same logical node" across two parses (before and after
 * a patch), and any edit that changes the patched text's length shifts every later offset.
 */

import type { AdapterWriter, LocatedNode, NodeRef } from '@voxfold/core'
import type { RootNode, TextNode } from '@vue/compiler-core'
import type { AstNode } from '../ast-path.ts'
import { nodeAtStructuralPath } from '../ast-path.ts'
import { parseVueSfc } from '../index.ts'
import { isLinear, templateTextOffsets } from '../template-entities.ts'
import { encodeTemplateText } from './encode.ts'

function locate(ast: { root: RootNode; source: string }, ref: NodeRef): LocatedNode {
  const node = nodeAtStructuralPath(ast.root as unknown as AstNode, ref.path)
  if (!node) throw new Error(`no node at structural path "${ref.path}"`)

  if (ref.type !== 'text') {
    throw new Error(`node type "${ref.type}" is not an editable text node`)
  }
  // node.type === 2 is Vue's NodeTypes.TEXT; checked by number since ast-path's generic AstNode
  // doesn't import the enum (keeping that module format-shape-agnostic beyond a `type` field).
  if (node.type !== 2) {
    throw new Error(`node at "${ref.path}" is a type-${node.type} node, expected a text node`)
  }

  const text = node as unknown as TextNode
  const start = text.loc.start.offset
  const end = text.loc.end.offset
  const raw = ast.source.slice(start, end)
  const decoded = text.content
  const offsets = templateTextOffsets(decoded, raw, start)

  return {
    valueRange: { start, end },
    decoded,
    ...(isLinear(offsets) ? {} : { charMap: offsets }),
    nodeType: 'text',
  }
}

/**
 * Structure without positions or the masked nodes' own text: every node's type, keyed by its
 * structural path — a `NodeRef.path` from extract() IS this path already, so masking here is a
 * direct set-membership check.
 */
function fingerprint(
  ast: { root: RootNode; source: string },
  maskedRefs: readonly NodeRef[],
): string {
  const maskedPaths = new Set(maskedRefs.map((ref) => ref.path))
  const parts: string[] = []
  const CHILD_KEYS = ['children', 'props', 'content', 'value', 'arg', 'exp'] as const

  const visit = (node: AstNode, path: string): void => {
    const masked = maskedPaths.has(path)
    if (masked) {
      parts.push(`${path}:${node.type}:*`)
    } else if (node.type === 2 || node.type === 3) {
      // TEXT or COMMENT: include the content, so an unmasked text edit is caught.
      parts.push(`${path}:${node.type}:${(node as unknown as { content: string }).content}`)
    } else if (node.type === 1) {
      parts.push(`${path}:1:${(node as unknown as { tag: string }).tag}`)
    } else {
      parts.push(`${path}:${node.type}`)
    }

    for (const key of CHILD_KEYS) {
      const value = (node as unknown as Record<string, unknown>)[key]
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          if (item && typeof item === 'object' && 'type' in item) {
            visit(item as AstNode, path ? `${path}.${key}[${index}]` : `${key}[${index}]`)
          }
        })
      } else if (value && typeof value === 'object' && 'type' in value) {
        visit(value as AstNode, path ? `${path}.${key}` : key)
      }
    }
  }

  visit(ast.root as unknown as AstNode, '')
  return parts.join('|')
}

function encode(newDecoded: string, located: LocatedNode): string {
  if (located.nodeType === 'text') return encodeTemplateText(newDecoded)
  throw new Error(`no encoder for node type "${located.nodeType}"`)
}

export const vueWriter: AdapterWriter<{ root: RootNode; source: string }> = {
  parse: (text) => ({ root: parseVueSfc(text), source: text }),
  locate,
  encode,
  fingerprint,
}
