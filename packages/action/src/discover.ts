/** Resolve the `paths` input to an absolute file list, filtered to supported formats. */

import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import fg from 'fast-glob'
import { formatForPath } from './format.ts'

const ALWAYS_IGNORED = ['**/node_modules/**', '**/.git/**']

export async function discoverFiles(cwd: string, patterns: string[]): Promise<string[]> {
  const found = new Set<string>()
  for (const pattern of patterns) {
    const literalPath = resolve(cwd, pattern)
    if (existsSync(literalPath)) {
      const stat = statSync(literalPath)
      if (stat.isDirectory()) {
        const entries = await fg('**/*.{md,markdown,mdx,html,htm,jsx,tsx,vue}', {
          cwd: literalPath,
          absolute: true,
          dot: false,
          ignore: ALWAYS_IGNORED,
        })
        for (const entry of entries) found.add(entry)
        continue
      }
      found.add(literalPath)
      continue
    }
    const entries = await fg(pattern, { cwd, absolute: true, dot: false, ignore: ALWAYS_IGNORED })
    for (const entry of entries) found.add(entry)
  }
  return [...found].filter((f) => formatForPath(f) !== undefined).sort()
}
