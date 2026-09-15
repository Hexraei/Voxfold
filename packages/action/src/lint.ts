/**
 * Lints one side (base or head) of a set of files, reusing @voxfold/core's engine directly —
 * no subprocess, no CLI shelling out, so the action and the CLI never drift on what a "flag"
 * means.
 */

import {
  combineScores,
  type Flag,
  type LintResult,
  lint,
  type ProseDocument,
  type RuleSet,
} from '@voxfold/core'
import { astroAdapter } from '@voxfold/lang-astro'
import { htmlAdapter } from '@voxfold/lang-html'
import { jsxAdapter } from '@voxfold/lang-jsx'
import { markdownAdapter } from '@voxfold/lang-markdown'
import { svelteAdapter } from '@voxfold/lang-svelte'
import { vueAdapter } from '@voxfold/lang-vue'
import { recommended } from '@voxfold/rules-recommended'
import type { SupportedFormat } from './format.ts'

export interface FileResult {
  path: string
  document: ProseDocument
  result: LintResult
}

async function extract(text: string, format: SupportedFormat, uri: string): Promise<ProseDocument> {
  if (format === 'html') return (await htmlAdapter.extract(text, { uri })) as ProseDocument
  if (format === 'jsx') return (await jsxAdapter.extract(text, { uri })) as ProseDocument
  if (format === 'vue') return (await vueAdapter.extract(text, { uri })) as ProseDocument
  if (format === 'svelte') return (await svelteAdapter.extract(text, { uri })) as ProseDocument
  if (format === 'astro') return (await astroAdapter.extract(text, { uri })) as ProseDocument
  return (await markdownAdapter.extract(text, {
    uri,
    settings: { mdx: format === 'mdx' },
  })) as ProseDocument
}

export async function lintText(
  path: string,
  format: SupportedFormat,
  text: string,
  ruleset: RuleSet = recommended,
): Promise<FileResult> {
  const document = await extract(text, format, path)
  const result = lint(document, ruleset)
  return { path, document, result }
}

export interface ProjectSummary {
  files: FileResult[]
  score: LintResult['score']
  totalWords: number
  totalFlags: number
}

export function summarize(files: readonly FileResult[]): ProjectSummary {
  const score = combineScores(
    files.map((f) => ({ contribution: f.result.stats.contribution, words: f.result.stats.words })),
    files[0]?.result.ruleset ?? `${recommended.name}@${recommended.version}`,
  )
  return {
    files: [...files],
    score,
    totalWords: files.reduce((sum, f) => sum + f.result.stats.words, 0),
    totalFlags: files.reduce((sum, f) => sum + f.result.flags.length, 0),
  }
}

export interface FlagWithFile {
  path: string
  flag: Flag
}

export function allFlags(files: readonly FileResult[]): FlagWithFile[] {
  return files.flatMap((f) => f.result.flags.map((flag) => ({ path: f.path, flag })))
}
