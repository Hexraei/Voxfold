/**
 * File discovery: patterns and bare paths on the command line → a list of lintable files.
 *
 * `.gitignore` is respected by default, matching what every other tool in a repo already does —
 * linting `node_modules` or build output by accident is a worse default than occasionally having
 * to pass `--no-gitignore` for the rare repo that wants it linted anyway.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import fg from 'fast-glob'
import ignore, { type Ignore } from 'ignore'

export type SupportedFormat = 'markdown' | 'mdx' | 'html' | 'jsx' | 'vue' | 'svelte'

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
}

export function formatForPath(path: string): SupportedFormat | undefined {
  const dot = path.lastIndexOf('.')
  if (dot === -1) return undefined
  return EXTENSION_FORMAT[path.slice(dot).toLowerCase()]
}

const ALWAYS_IGNORED = ['**/node_modules/**', '**/.git/**']

/** Build a combined matcher for every `.gitignore` between `root` and each candidate file. */
function loadGitignore(root: string): Ignore {
  const ig = ignore()
  const path = join(root, '.gitignore')
  if (existsSync(path)) {
    ig.add(readFileSync(path, 'utf8'))
  }
  return ig
}

export interface DiscoverOptions {
  cwd: string
  patterns: string[]
  useGitignore: boolean
  extraIgnores?: string[]
}

/**
 * Resolve CLI arguments to an absolute, deduplicated file list.
 *
 * A bare existing path (file or directory) is treated literally rather than as a glob, so
 * `voxfold docs` works without the user needing to know glob syntax, while `voxfold "**\/*.md"`
 * still works for anyone who wants it.
 */
export async function discoverFiles(options: DiscoverOptions): Promise<string[]> {
  const { cwd, useGitignore } = options
  const ig = useGitignore ? loadGitignore(cwd) : ignore()
  if (options.extraIgnores) ig.add(options.extraIgnores)

  const patterns = options.patterns.length > 0 ? options.patterns : ['.']
  const found = new Set<string>()

  for (const pattern of patterns) {
    const literalPath = resolve(cwd, pattern)
    if (existsSync(literalPath)) {
      const stat = statSync(literalPath)
      if (stat.isDirectory()) {
        const entries = await fg('**/*.{md,markdown,mdx,html,htm,jsx,tsx,vue,svelte}', {
          cwd: literalPath,
          absolute: true,
          dot: false,
          ignore: ALWAYS_IGNORED,
        })
        for (const entry of entries) found.add(entry)
        continue
      }
      if (stat.isFile()) {
        found.add(literalPath)
        continue
      }
    }

    // Not an existing literal path: treat it as a glob relative to cwd.
    const entries = await fg(pattern, { cwd, absolute: true, dot: false, ignore: ALWAYS_IGNORED })
    for (const entry of entries) found.add(entry)
  }

  const lintable = [...found].filter((file) => formatForPath(file) !== undefined)
  const kept = lintable.filter((file) => {
    const rel = relative(cwd, file)
    // A file outside cwd (e.g. an absolute path elsewhere on disk) has no .gitignore
    // relationship to this project's ignore rules, and the `ignore` package throws on a
    // relative path that escapes upward (starts with "..") rather than silently accepting it.
    if (rel.startsWith('..')) return true
    return !ig.ignores(rel)
  })
  return kept.sort()
}

/** Directory containing `.git`, walking up from `cwd`; used as the root for `.gitignore` lookup. */
export function findGitRoot(cwd: string): string {
  let dir = resolve(cwd)
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return cwd
    dir = parent
  }
}
