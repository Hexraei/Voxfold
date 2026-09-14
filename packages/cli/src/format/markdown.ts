/**
 * Markdown formatter, aimed at the sticky PR comment the GitHub Action posts (M13), but usable
 * standalone via `--format markdown` too.
 */

import type { ProjectSummary } from '../lint-runner.ts'
import { displayPath } from './display-path.ts'

function lineOf(source: string | undefined, offset: number): number {
  if (!source) return 1
  let line = 1
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === '\n') line++
  return line
}

export function formatMarkdown(summary: ProjectSummary, cwd: string): string {
  const lines: string[] = []

  if (summary.score) {
    lines.push(`### Style score: ${summary.score.value} / 100 (${summary.score.grade})`, '')
    lines.push(
      `\`${summary.score.ruleset}\` · ${summary.totalWords} words · ${summary.totalFlags} flags`,
      '',
    )
  } else {
    lines.push('### Style score: not enough text to score', '')
  }

  const filesWithFlags = summary.files.filter((f) => f.result.flags.length > 0)
  if (filesWithFlags.length === 0) {
    lines.push('No tells found.')
    return `${lines.join('\n')}\n`
  }

  for (const { file, document, result } of filesWithFlags) {
    lines.push(
      `<details><summary><code>${displayPath(file, cwd)}</code> — ${result.flags.length} flag${result.flags.length === 1 ? '' : 's'}</summary>`,
      '',
    )
    lines.push('| Line | Rule | Message |', '|---|---|---|')
    for (const flag of result.flags) {
      const line = lineOf(document.source, flag.sourceRanges[0]?.start ?? 0)
      lines.push(`| ${line} | \`${flag.ruleId}\` | ${flag.message} |`)
    }
    lines.push('', '</details>', '')
  }

  return `${lines.join('\n')}\n`
}
