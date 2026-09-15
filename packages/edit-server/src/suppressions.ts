/**
 * Suppressions file I/O for the overlay's "Ignore" action.
 *
 * Deliberately a small, self-contained copy of the same read/write logic `voxfold`'s CLI uses
 * (`packages/cli/src/suppressions.ts`) rather than a shared dependency: the edit server and the
 * CLI are both leaf consumers of the suppressions file FORMAT (defined by `SuppressionsFile` in
 * `@voxfold/core`), and neither should depend on the other. If this drifts from the CLI's copy in
 * a way that matters, the fix is promoting both to a shared package — not making the edit server
 * depend on the CLI.
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import type { SuppressionsFile } from '@voxfold/core'

export async function loadSuppressions(path: string): Promise<SuppressionsFile | undefined> {
  if (!existsSync(path)) return undefined
  const text = await readFile(path, 'utf8')
  const parsed = JSON.parse(text) as SuppressionsFile
  if (parsed.version !== 1) {
    throw new Error(`${path}: unsupported suppressions file version ${parsed.version}`)
  }
  return parsed
}

export async function saveSuppressions(path: string, file: SuppressionsFile): Promise<void> {
  // Stable key order so the file diffs cleanly in git.
  const sortedFiles: SuppressionsFile['files'] = {}
  for (const key of Object.keys(file.files).sort()) {
    sortedFiles[key] = [...file.files[key]!].sort(
      (a, b) => a.rule.localeCompare(b.rule) || a.hash.localeCompare(b.hash),
    )
  }
  await writeFile(path, `${JSON.stringify({ version: 1, files: sortedFiles }, null, 2)}\n`)
}

/** Mutates `file` in place, adding one entry (a no-op if it's already there). */
export function writeSuppressionEntry(
  file: SuppressionsFile,
  key: string,
  ruleId: string,
  hash: string,
): void {
  file.files[key] ??= []
  const list = file.files[key]
  const already = list.some((entry) => entry.rule === ruleId && entry.hash === hash)
  if (!already) list.push({ rule: ruleId, hash })
}
