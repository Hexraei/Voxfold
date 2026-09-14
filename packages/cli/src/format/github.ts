/**
 * GitHub Actions workflow commands (`::warning file=...,line=...::message`), so a plain CLI run
 * inside a workflow — without the dedicated Action — still annotates the diff.
 */

import type { ProjectSummary } from '../lint-runner.ts'
import { displayPath } from './display-path.ts'

function lineOf(source: string | undefined, offset: number): number {
  if (!source) return 1
  let line = 1
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === '\n') line++
  return line
}

/** Workflow command values cannot contain raw %, \r or \n. */
function escapeWorkflowCommand(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

export function formatGithub(summary: ProjectSummary, cwd: string): string {
  const lines: string[] = []
  for (const { file, document, result } of summary.files) {
    const relPath = displayPath(file, cwd).split('\\').join('/')
    for (const flag of result.flags) {
      const line = lineOf(document.source, flag.sourceRanges[0]?.start ?? 0)
      const level = flag.severity === 'error' ? 'error' : 'warning'
      lines.push(
        `::${level} file=${relPath},line=${line},title=voxfold/${flag.ruleId}::${escapeWorkflowCommand(flag.message)}`,
      )
    }
  }
  if (summary.score) {
    lines.push(`::notice title=voxfold score::${summary.score.value}/100 (${summary.score.grade})`)
  }
  return `${lines.join('\n')}\n`
}
