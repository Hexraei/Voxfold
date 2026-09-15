/**
 * Writer hooks for Svelte components: locate a template text node by the structural `NodeRef`
 * extract() already stamps on every editable segment, patch its decoded value, and prove the rest
 * of the tree didn't move.
 *
 * `NodeRef.path` is a structural (sibling-index) path from the file root — same idea as
 * lang-vue's/lang-jsx's tree paths, computed by `../ast-path.ts` — rather than a source-position
 * pair, since the writer needs to identify "the same logical node" across two parses (before and
 * after a patch), and any edit that changes the patched text's length shifts every later offset.
 */

import type { AdapterWriter, LocatedNode, NodeRef } from '@voxfold/core'
import type { AST } from 'svelte/compiler'
import type { AstNode } from '../ast-path.ts'
import { nodeAtStructuralPath } from '../ast-path.ts'
import { parseSvelteFile } from '../index.ts'
import { isLinear, templateTextOffsets } from '../template-entities.ts'
import { encodeTemplateText } from './encode.ts'

function locate(ast: { root: AST.Root; source: string }, ref: NodeRef): LocatedNode {
  const node = nodeAtStructuralPath(ast.root as unknown as AstNode, ref.path)
  if (!node) throw new Error(`no node at structural path "${ref.path}"`)

  if (ref.type !== 'text') {
    throw new Error(`node type "${ref.type}" is not an editable text node`)
  }
  if (node.type !== 'Text') {
    throw new Error(`node at "${ref.path}" is a type-${node.type} node, expected a Text node`)
  }

  const text = node as unknown as AST.Text
  const start = text.start
  const end = text.end
  const raw = ast.source.slice(start, end)
  const decoded = text.data
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
  ast: { root: AST.Root; source: string },
  maskedRefs: readonly NodeRef[],
): string {
  const maskedPaths = new Set(maskedRefs.map((ref) => ref.path))
  const parts: string[] = []
  const FRAGMENT_KEYS = ['fragment', 'body', 'consequent', 'alternate', 'fallback'] as const
  const OTHER_CHILD_KEYS = ['expression', 'attributes', 'value'] as const

  function isFragment(value: unknown): value is { type: 'Fragment'; nodes: unknown[] } {
    return Boolean(value) && typeof value === 'object' && (value as AstNode).type === 'Fragment'
  }

  const visit = (node: AstNode, path: string): void => {
    const masked = maskedPaths.has(path)
    if (masked) {
      parts.push(`${path}:${node.type}:*`)
    } else if (node.type === 'Text') {
      parts.push(`${path}:Text:${(node as unknown as AST.Text).data}`)
    } else if (node.type === 'Comment') {
      parts.push(`${path}:Comment:${(node as unknown as AST.Comment).data}`)
    } else if (node.type === 'RegularElement') {
      parts.push(`${path}:RegularElement:${(node as unknown as AST.RegularElement).name}`)
    } else {
      parts.push(`${path}:${node.type}`)
    }

    for (const key of FRAGMENT_KEYS) {
      const value = (node as unknown as Record<string, unknown>)[key]
      if (isFragment(value)) {
        value.nodes.forEach((item, index) => {
          if (item && typeof item === 'object' && 'type' in item) {
            visit(item as AstNode, path ? `${path}.${key}[${index}]` : `${key}[${index}]`)
          }
        })
      }
    }
    for (const key of OTHER_CHILD_KEYS) {
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

export const svelteWriter: AdapterWriter<{ root: AST.Root; source: string }> = {
  parse: (text) => ({ root: parseSvelteFile(text), source: text }),
  locate,
  encode,
  fingerprint,
}
