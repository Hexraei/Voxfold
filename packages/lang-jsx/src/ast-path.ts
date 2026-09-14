/**
 * Structural (sibling-index) paths for Babel AST nodes, shared between extract() and the writer.
 *
 * A `${start}-${end}` position pair is exact within ONE parse, but the writer needs to identify
 * "the same logical node" across TWO parses of different text (before and after a patch) — and
 * every offset after the patched span shifts the moment the patched text is a different length.
 * A structural path (the chain of object-key/array-index steps from the Program root down to the
 * node) has no such problem: it depends only on the tree's SHAPE, which the write protocol's own
 * fingerprint check exists to prove is unchanged apart from the targeted text.
 */

import type { Node as BabelNode } from '@babel/types'

function isNodeLike(value: unknown): value is BabelNode {
  return Boolean(value) && typeof value === 'object' && 'type' in (value as object)
}

const SKIP_KEYS = new Set(['loc', 'start', 'end', 'range', 'extra'])

/** Walk `root`'s own properties (not `root` itself) looking for a structural path to `target`. */
export function structuralPathTo(root: BabelNode, target: BabelNode): string | undefined {
  if (root === target) return ''

  for (const key of Object.keys(root)) {
    if (SKIP_KEYS.has(key)) continue
    const value = (root as unknown as Record<string, unknown>)[key]
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item: unknown = value[i]
        if (!isNodeLike(item)) continue
        if (item === target) return `${key}[${i}]`
        const nested = structuralPathTo(item, target)
        if (nested !== undefined) return `${key}[${i}].${nested}`
      }
    } else if (isNodeLike(value)) {
      if (value === target) return key
      const nested = structuralPathTo(value, target)
      if (nested !== undefined) return `${key}.${nested}`
    }
  }

  return undefined
}

/** Resolve a structural path (as produced by `structuralPathTo`) back to a node, or undefined. */
export function nodeAtStructuralPath(root: BabelNode, path: string): BabelNode | undefined {
  if (path === '') return root
  let current: unknown = root
  for (const segment of path.split('.')) {
    const match = /^([A-Za-z0-9_$]+)(?:\[(\d+)\])?$/.exec(segment)
    if (!match || !isNodeLike(current)) return undefined
    const [, key, indexStr] = match
    const value = (current as unknown as Record<string, unknown>)[key!]
    current = indexStr !== undefined ? (value as unknown[])?.[Number(indexStr)] : value
  }
  return isNodeLike(current) ? current : undefined
}

/** Generic visitor over every node in a Babel tree, depth-first, skipping position metadata. */
export function visitNodes(root: BabelNode, onNode: (node: BabelNode) => void): void {
  const visit = (node: unknown): void => {
    if (!isNodeLike(node)) return
    onNode(node)
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue
      const value = (node as unknown as Record<string, unknown>)[key]
      if (Array.isArray(value)) {
        for (const item of value) visit(item)
      } else {
        visit(value)
      }
    }
  }
  visit(root)
}
