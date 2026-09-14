import type { ProjectSummary } from '../lint-runner.ts'
import { formatGithub } from './github.ts'
import { formatJson } from './json.ts'
import { formatMarkdown } from './markdown.ts'
import { formatSarif } from './sarif.ts'
import { formatStylish } from './stylish.ts'

export type FormatterName = 'stylish' | 'json' | 'sarif' | 'github' | 'markdown'

export const FORMATTER_NAMES: readonly FormatterName[] = [
  'stylish',
  'json',
  'sarif',
  'github',
  'markdown',
]

const FORMATTERS: Record<FormatterName, (summary: ProjectSummary, cwd: string) => string> = {
  stylish: formatStylish,
  json: formatJson,
  sarif: formatSarif,
  github: formatGithub,
  markdown: formatMarkdown,
}

export function isFormatterName(name: string): name is FormatterName {
  return name in FORMATTERS
}

export function format(name: FormatterName, summary: ProjectSummary, cwd: string): string {
  return FORMATTERS[name](summary, cwd)
}
