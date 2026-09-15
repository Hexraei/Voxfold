/**
 * Structural (sibling-index) paths through `@astrojs/compiler`'s AST, shared between extract()
 * and the writer — same idea as `lang-vue`/`lang-svelte`'s `ast-path.ts`. A `${start}-${end}`
 * offset pair is exact within one parse, but the writer needs to find "the same logical node"
 * across two parses (before and after a patch), and any edit shifts every later node's byte AND
 * UTF-16 offsets. A structural path depends only on tree shape.
 *
 * Every parent-like node (`root`, `element`, `component`, `custom-element`, `fragment`,
 * `expression`) holds its children under one `children` array, unlike Svelte's several
 * differently-named keys — so this is simpler than lang-svelte's equivalent.
 */

export interface AstNode {
  type: string
  children?: AstNode[]
  [key: string]: unknown
}

function hasChildren(node: AstNode): node is AstNode & { children: AstNode[] } {
  return Array.isArray(node.children)
}

export function structuralPathTo(root: AstNode, target: AstNode): string | undefined {
  if (root === target) return ''
  if (!hasChildren(root)) return undefined

  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i]!
    if (child === target) return `children[${i}]`
    const nested = structuralPathTo(child, target)
    if (nested !== undefined) return `children[${i}].${nested}`
  }
  return undefined
}

export function nodeAtStructuralPath(root: AstNode, path: string): AstNode | undefined {
  if (path === '') return root
  let current: AstNode | undefined = root
  for (const segment of path.split('.')) {
    const match = /^children\[(\d+)\]$/.exec(segment)
    if (!match || !current || !hasChildren(current)) return undefined
    current = current.children[Number(match[1])]
  }
  return current
}

/** Generic visitor over every node in the tree, depth-first, root included. */
export function visitNodes(root: AstNode, onNode: (node: AstNode) => void): void {
  onNode(root)
  if (hasChildren(root)) for (const child of root.children) visitNodes(child, onNode)
}
