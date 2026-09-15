/** Extension -> format mapping, matching the CLI's `discover.ts` supported set. */

export type SupportedFormat = 'markdown' | 'mdx' | 'html' | 'jsx' | 'vue' | 'svelte' | 'astro'

const EXTENSION_FORMAT: Record<string, SupportedFormat> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'mdx',
  '.html': 'html',
  '.htm': 'html',
  '.jsx': 'jsx',
  '.tsx': 'jsx',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.astro': 'astro',
}

export function formatForPath(path: string): SupportedFormat | undefined {
  const dot = path.lastIndexOf('.')
  if (dot === -1) return undefined
  return EXTENSION_FORMAT[path.slice(dot).toLowerCase()]
}
