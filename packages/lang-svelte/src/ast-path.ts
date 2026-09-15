/**
 * Structural (sibling-index) paths through `svelte/compiler`'s modern AST, shared between
 * extract() and the writer — same idea as `@voxfold/lang-vue`'s `ast-path.ts`.
 *
 * A `${start}-${end}` offset pair is exact within one parse, but the writer needs to find "the
 * same logical node" across two parses of different text (before and after a patch), and any edit
 * shifts every later node's offset. A structural path depends only on the tree's shape, which is
 * unaffected by that — the write protocol's fingerprint check is what proves the shape itself
 * didn't move apart from the targeted text.
 *
 * Svelte's modern AST nests child nodes under several differently-named keys depending on node
 * kind: `fragment.nodes` (elements, blocks), `body`/`consequent`/`alternate`/`fallback`/`then`/
 * `catch`/`pending` (block bodies, each holding a `Fragment`), and `attributes` (element
 * attributes, which can themselves hold `ExpressionTag`s in `Attribute.value`). This walks that
 * fixed set of keys rather than every own-property.
 */

interface AstNode {
  type: string
  [key: string]: unknown
}

function isNodeLike(value: unknown): value is AstNode {
  return Boolean(value) && typeof value === 'object' && 'type' in (value as object)
}

/** A `Fragment` is `{ type: 'Fragment', nodes: [...] }` — not itself node-like by `isNodeLike`
 * (no useful `type` to branch on beyond routing into `nodes`), so it's unwrapped explicitly. */
function isFragment(value: unknown): value is { type: 'Fragment'; nodes: unknown[] } {
  return (
    Boolean(value) && typeof value === 'object' && (value as { type?: unknown }).type === 'Fragment'
  )
}

const FRAGMENT_KEYS = ['fragment', 'body', 'consequent', 'alternate', 'fallback'] as const
const CHILD_KEYS = ['expression', 'attributes'] as const

function childEntries(node: AstNode): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = []
  for (const key of FRAGMENT_KEYS) {
    const value = node[key]
    if (isFragment(value)) entries.push([key, value.nodes])
  }
  for (const key of CHILD_KEYS) {
    if (key in node) entries.push([key, node[key]])
  }
  // Attribute.value can be `true | ExpressionTag | Array<Text | ExpressionTag>` — only the
  // array/single-node forms carry nodes worth walking.
  if (node.type === 'Attribute' && node.value !== true) entries.push(['value', node.value])
  return entries
}

export function structuralPathTo(root: AstNode, target: AstNode): string | undefined {
  if (root === target) return ''

  for (const [key, value] of childEntries(root)) {
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

export function nodeAtStructuralPath(root: AstNode, path: string): AstNode | undefined {
  if (path === '') return root
  let current: unknown = root
  for (const segment of path.split('.')) {
    const match = /^([A-Za-z0-9_$]+)(?:\[(\d+)\])?$/.exec(segment)
    if (!match || !isNodeLike(current)) return undefined
    const [, key, indexStr] = match
    let value: unknown
    if (FRAGMENT_KEYS.includes(key as (typeof FRAGMENT_KEYS)[number])) {
      const fragment = (current as AstNode)[key!]
      value = isFragment(fragment) ? fragment.nodes : undefined
    } else {
      value = (current as AstNode)[key!]
    }
    current = indexStr !== undefined ? (value as unknown[])?.[Number(indexStr)] : value
  }
  return isNodeLike(current) ? current : undefined
}

/** Generic visitor over every node in the template tree, depth-first, root included. */
export function visitNodes(root: AstNode, onNode: (node: AstNode) => void): void {
  const visit = (node: unknown): void => {
    if (!isNodeLike(node)) return
    onNode(node)
    for (const [, value] of childEntries(node)) {
      if (Array.isArray(value)) {
        for (const item of value) visit(item)
      } else {
        visit(value)
      }
    }
  }
  visit(root)
}

export type { AstNode }
