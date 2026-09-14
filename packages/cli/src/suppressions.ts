/**
 * Suppressions file I/O: `voxfold-suppressions.json`.
 *
 * A checked-in complement to inline disable comments — useful for adopting the linter on a
 * legacy repo without touching every file, or for a flag someone wants ignored without leaving a
 * comment in the source. The overlay's "Ignore" button and `--suppress-rule` both write here;
 * the engine (in @voxfold/core) is what actually honors it during linting.
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import type { Flag, SuppressionsFile } from '@voxfold/core'

export const SUPPRESSIONS_FILENAME = 'voxfold-suppressions.json'

/**
 * The key a file is recorded under in the suppressions file, and the same value that must be
 * used as `document.uri` (via `lintFile`'s `uri` parameter) so the engine's suppression lookup —
 * a plain `document.uri` string match, with no path knowledge of its own — actually finds it.
 * Anchored to the suppressions file's OWN directory, not `process.cwd()`: cwd can change between
 * the run that writes a suppression and the run that reads it (a subdirectory, CI, another
 * machine), while the suppressions file's location is fixed once chosen.
 */
export function suppressionKeyFor(suppressionsPath: string, file: string): string {
  return relative(dirname(suppressionsPath), file).split('\\').join('/')
}

export async function loadSuppressions(path: string): Promise<SuppressionsFile | undefined> {
  if (!existsSync(path)) return undefined
  const text = await readFile(path, 'utf8')
  const parsed = JSON.parse(text) as SuppressionsFile
  if (parsed.version !== 1) {
    throw new Error(`${path}: unsupported suppressions file version ${parsed.version}`)
  }
  return parsed
}

async function writeSuppressions(path: string, file: SuppressionsFile): Promise<void> {
  // Stable key order so the file diffs cleanly in git: files sorted, and each file's entries
  // sorted by rule then hash. A suppressions file this many people can write to needs to merge
  // predictably.
  const sortedFiles: SuppressionsFile['files'] = {}
  for (const key of Object.keys(file.files).sort()) {
    sortedFiles[key] = [...file.files[key]!].sort(
      (a, b) => a.rule.localeCompare(b.rule) || a.hash.localeCompare(b.hash),
    )
  }
  await writeFile(path, `${JSON.stringify({ version: 1, files: sortedFiles }, null, 2)}\n`)
}

/**
 * Add every flag from `entries` (already filtered to what should be suppressed) to the file.
 * `entries[].file` must already be the suppressions key (`document.uri` / `suppressionKeyFor`'s
 * result) — this does not re-derive it, since by the time flags exist they were produced by
 * `lint()` against a `document.uri` that was already this key.
 */
export async function addSuppressions(
  path: string,
  entries: ReadonlyArray<{ file: string; flag: Flag }>,
): Promise<number> {
  const existing = (await loadSuppressions(path)) ?? { version: 1 as const, files: {} }
  let added = 0

  for (const { file: key, flag } of entries) {
    existing.files[key] ??= []
    const list = existing.files[key]
    const already = list.some((entry) => entry.rule === flag.ruleId && entry.hash === flag.hash)
    if (already) continue
    list.push({ rule: flag.ruleId, hash: flag.hash })
    added++
  }

  await writeSuppressions(path, existing)
  return added
}

/** Remove suppression entries whose flag no longer appears in the current lint results. */
export async function pruneSuppressions(
  path: string,
  stillPresent: ReadonlySet<string>,
): Promise<number> {
  const existing = await loadSuppressions(path)
  if (!existing) return 0

  let removed = 0
  const files: SuppressionsFile['files'] = {}
  for (const [file, entries] of Object.entries(existing.files)) {
    const kept = entries.filter((entry) => {
      const key = `${file}::${entry.rule}::${entry.hash}`
      const keep = stillPresent.has(key)
      if (!keep) removed++
      return keep
    })
    if (kept.length > 0) files[file] = kept
  }

  await writeSuppressions(path, { version: 1, files })
  return removed
}
