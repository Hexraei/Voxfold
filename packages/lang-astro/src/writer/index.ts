/**
 * Writer hooks for Astro components: locate a template text node by the structural `NodeRef`
 * extract() already stamps on every editable segment, patch its decoded value, and prove the rest
 * of the tree didn't move.
 *
 * `NodeRef.path` is a structural (sibling-index) path from the file root — same idea as
 * lang-vue's/lang-svelte's tree paths, computed by `../ast-path.ts` — rather than a source-position
 * pair, since any edit that changes the patched text's length shifts every later offset (and here,
 * every later BYTE offset too — see `../byte-offsets.ts`).
 */

import type { RootNode, TextNode } from '@astrojs/compiler/types'
import type { AdapterWriter, LocatedNode, NodeRef } from '@voxfold/core'
import type { AstNode } from '../ast-path.ts'
import { nodeAtStructuralPath } from '../ast-path.ts'
import { ByteOffsetMap } from '../byte-offsets.ts'
import { parseAstroFileSync } from '../index.ts'
import { decodeTemplateText, isLinear } from '../template-entities.ts'
import { encodeTemplateText } from './encode.ts'

export interface AstroWriterAst {
  root: RootNode
  source: string
  bytes: ByteOffsetMap
}

function locate(ast: AstroWriterAst, ref: NodeRef): LocatedNode {
  const node = nodeAtStructuralPath(ast.root as unknown as AstNode, ref.path)
  if (!node) throw new Error(`no node at structural path "${ref.path}"`)

  if (ref.type !== 'text') {
    throw new Error(`node type "${ref.type}" is not an editable text node`)
  }
  if (node.type !== 'text') {
    throw new Error(`node at "${ref.path}" is a type-${node.type} node, expected a text node`)
  }

  const text = node as unknown as TextNode
  // UTF-16 span for the node's OWN raw value, not the AST's own (byte-based, and sometimes
  // overshooting — see index.ts's module doc) `end` offset.
  const start = ast.bytes.toUtf16(text.position?.start.offset ?? 0)
  const end = start + text.value.length
  // .value is NOT entity-decoded by @astrojs/compiler (see index.ts's module doc) — decode here,
  // the same as extract() does, so the writer's round-trip contract holds: encode() escapes a
  // literal `<`/`{`/`}` as an entity to keep the file parseable, and this must decode it back to
  // the exact text that was written, or `@voxfold/writer`'s "reads back as X, expected Y" check
  // fails (caught by a real fault-injection-style test, not assumed).
  const raw = ast.source.slice(start, end)
  const { decoded, offsets } = decodeTemplateText(raw, start)

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
function fingerprint(ast: AstroWriterAst, maskedRefs: readonly NodeRef[]): string {
  const maskedPaths = new Set(maskedRefs.map((ref) => ref.path))
  const parts: string[] = []

  const visit = (node: AstNode, path: string): void => {
    const masked = maskedPaths.has(path)
    if (masked) {
      parts.push(`${path}:${node.type}:*`)
    } else if (node.type === 'text') {
      parts.push(`${path}:text:${(node as unknown as TextNode).value}`)
    } else if (node.type === 'comment') {
      parts.push(`${path}:comment:${(node as unknown as { value: string }).value}`)
    } else if (
      node.type === 'element' ||
      node.type === 'component' ||
      node.type === 'custom-element'
    ) {
      parts.push(`${path}:${node.type}:${(node as unknown as { name: string }).name}`)
    } else {
      parts.push(`${path}:${node.type}`)
    }

    const children = (node as unknown as { children?: AstNode[] }).children
    if (Array.isArray(children)) {
      children.forEach((child, index) => {
        visit(child, path ? `${path}.children[${index}]` : `children[${index}]`)
      })
    }
  }

  visit(ast.root as unknown as AstNode, '')
  return parts.join('|')
}

function encode(newDecoded: string, located: LocatedNode): string {
  if (located.nodeType === 'text') return encodeTemplateText(newDecoded)
  throw new Error(`no encoder for node type "${located.nodeType}"`)
}

export const astroWriter: AdapterWriter<AstroWriterAst> = {
  parse: (text) => ({
    root: parseAstroFileSync(text),
    source: text,
    bytes: new ByteOffsetMap(text),
  }),
  locate,
  encode,
  fingerprint,
}
