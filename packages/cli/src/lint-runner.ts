/**
 * Runs the engine over a set of already-extracted documents and aggregates the results the way
 * the CLI needs them: per file, and combined for a project-wide gate.
 */

import { readFile } from 'node:fs/promises'
import {
  applyFixes,
  combineScores,
  type Flag,
  type LintResult,
  lint,
  type ProseDocument,
  type RuleOverrides,
  type RuleSet,
  type SuppressionsFile,
} from '@voxfold/core'
import { htmlAdapter } from '@voxfold/lang-html'
import { jsxAdapter } from '@voxfold/lang-jsx'
import { markdownAdapter } from '@voxfold/lang-markdown'
import { svelteAdapter } from '@voxfold/lang-svelte'
import { vueAdapter } from '@voxfold/lang-vue'
import type { SupportedFormat } from './discover.ts'

export interface FileResult {
  file: string
  document: ProseDocument
  result: LintResult
}

export interface RunOptions {
  ruleset: RuleSet
  overrides?: RuleOverrides
  suppressions?: SuppressionsFile
  includeSuppressed?: boolean
}

async function extractFile(
  file: string,
  format: SupportedFormat,
  uri: string,
): Promise<ProseDocument> {
  const text = await readFile(file, 'utf8')
  if (format === 'html') return (await htmlAdapter.extract(text, { uri })) as ProseDocument
  if (format === 'jsx') return (await jsxAdapter.extract(text, { uri })) as ProseDocument
  if (format === 'vue') return (await vueAdapter.extract(text, { uri })) as ProseDocument
  if (format === 'svelte') return (await svelteAdapter.extract(text, { uri })) as ProseDocument
  return (await markdownAdapter.extract(text, {
    uri,
    settings: { mdx: format === 'mdx' },
  })) as ProseDocument
}

/**
 * @param file Absolute (or cwd-relative) filesystem path to read.
 * @param uri  Identity to record on the document and use for suppression lookups. Must be
 *   exactly the same string `suppressions.ts` uses as the key when it WRITES an entry (the
 *   path relative to the suppressions file's directory) — the engine matches suppressions by
 *   `document.uri` verbatim, with no path normalization of its own, since it has no filesystem
 *   concept at all (it must run identically in a browser worker). A mismatch here means a
 *   suppression is silently never honored, which is worse than not having the feature: it looks
 *   like it worked (the CLI reports it wrote the entry) while every future lint ignores it.
 */
export async function lintFile(
  file: string,
  format: SupportedFormat,
  uri: string,
  options: RunOptions,
): Promise<FileResult> {
  const document = await extractFile(file, format, uri)
  const result = lint(document, options.ruleset, {
    ...(options.overrides ? { overrides: options.overrides } : {}),
    ...(options.suppressions ? { suppressions: options.suppressions } : {}),
    ...(options.includeSuppressed ? { includeSuppressed: true } : {}),
  })
  return { file, document, result }
}

export interface ProjectSummary {
  files: FileResult[]
  /** Word-weighted total across every file, so a short page cannot swing the gate alone. */
  score: LintResult['score']
  totalWords: number
  totalFlags: number
}

export function summarize(files: readonly FileResult[], ruleset: string): ProjectSummary {
  const score = combineScores(
    files.map((f) => ({ contribution: f.result.stats.contribution, words: f.result.stats.words })),
    ruleset,
  )
  return {
    files: [...files],
    score,
    totalWords: files.reduce((sum, f) => sum + f.result.stats.words, 0),
    totalFlags: files.reduce((sum, f) => sum + f.result.flags.length, 0),
  }
}

/**
 * Every flag across every file, flattened for suppression bookkeeping.
 *
 * `file` here is `document.uri` (the suppressions-file-relative key passed to `lintFile`), NOT
 * `FileResult.file` (the raw filesystem path used to read the file) — suppression entries are
 * always keyed and looked up by the former.
 */
export function allFlags(files: readonly FileResult[]): Array<{ file: string; flag: Flag }> {
  return files.flatMap((f) => f.result.flags.map((flag) => ({ file: f.document.uri, flag })))
}

/** Apply `--fix` to one file's text; returns the fixed text and count of fixes applied. */
export function fixFile(text: string, result: LintResult): { text: string; count: number } {
  const fixable = result.flags.filter((flag) => flag.fix)
  return { text: applyFixes(text, result.flags), count: fixable.length }
}
