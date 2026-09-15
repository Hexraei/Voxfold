/**
 * Structural (sibling-index) paths through `@vue/compiler-sfc`'s template AST, shared between
 * extract() and the writer — same idea as `@voxfold/lang-jsx`'s `ast-path.ts` for the Babel tree.
 *
 * A `${start}-${end}` offset pair is exact within one parse, but the writer needs to find "the
 * same logical node" across two parses of different text (before and after a patch), and any edit
 * shifts every later node's offset. A structural path depends only on the tree's shape, which is
 * unaffected by that — the write protocol's fingerprint check is what proves the shape itself
 * didn't move apart from the targeted text.
 *
 * The Vue template AST only ever nests other AST nodes under `children`, `props`, `content` (an
 * interpolation's expression) and `value` (an attribute's text) — unlike Babel's tree, which
 * scatters child nodes across many differently-named keys, so this walks a small fixed set of
 * keys rather than every own-property the way lang-jsx's Babel walker does.
 */

interface AstNode {
  type: number
  [key: string]: unknown
}

function isNodeLike(value: unknown): value is AstNode {
  return Boolean(value) && typeof value === 'object' && 'type' in (value as object)
}

const CHILD_KEYS = ['children', 'props', 'content', 'value', 'arg', 'exp'] as const

export function structuralPathTo(root: AstNode, target: AstNode): string | undefined {
  if (root === target) return ''

  for (const key of CHILD_KEYS) {
    const value = root[key]
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
    const value = current[key!]
    current = indexStr !== undefined ? (value as unknown[])?.[Number(indexStr)] : value
  }
  return isNodeLike(current) ? current : undefined
}

/** Generic visitor over every node in the template tree, depth-first, root included. */
export function visitNodes(root: AstNode, onNode: (node: AstNode) => void): void {
  const visit = (node: unknown): void => {
    if (!isNodeLike(node)) return
    onNode(node)
    for (const key of CHILD_KEYS) {
      const value = node[key]
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
