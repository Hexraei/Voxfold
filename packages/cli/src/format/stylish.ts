/**
 * The default terminal formatter. Designed to be screenshot-able — the primary distribution
 * surface is someone running `npx voxfold https://theirsite.com` and posting the result, so the
 * score box has to read cleanly out of context, without the rest of a terminal session around it.
 */

import pc from 'picocolors'
import type { ProjectSummary } from '../lint-runner.ts'
import { displayPath } from './display-path.ts'

function lineColOf(document: { source?: string }, offset: number): { line: number; col: number } {
  const source = document.source ?? ''
  let line = 1
  let lastNewline = -1
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++
      lastNewline = i
    }
  }
  return { line, col: offset - lastNewline }
}

function severityColor(severity: string, text: string): string {
  if (severity === 'error') return pc.red(text)
  return pc.yellow(text)
}

function gradeColor(grade: string): (text: string) => string {
  if (grade === 'A' || grade === 'B') return pc.green
  if (grade === 'C') return pc.yellow
  return pc.red
}

export function formatStylish(summary: ProjectSummary, cwd: string): string {
  const lines: string[] = []

  for (const { file, document, result } of summary.files) {
    if (result.flags.length === 0) continue
    lines.push('', pc.underline(displayPath(file, cwd)))

    for (const flag of result.flags) {
      const { line, col } = lineColOf(document, flag.sourceRanges[0]?.start ?? 0)
      const position = pc.dim(`${line}:${col}`.padEnd(8))
      const rule = severityColor(flag.severity, flag.ruleId.padEnd(24))
      const fixMark = flag.fix ? pc.cyan(' [fixable]') : ''
      const suggestMark = flag.suggestions && !flag.fix ? pc.dim(' [suggestion]') : ''
      lines.push(`  ${position} ${rule} ${flag.message}${fixMark}${suggestMark}`)
    }
  }

  lines.push('')
  if (summary.score) {
    const color = gradeColor(summary.score.grade)
    lines.push(
      color(`  Style score: ${summary.score.value} / 100  (${summary.score.grade})`) +
        pc.dim(`   ${summary.score.ruleset}`),
    )
  } else {
    lines.push(pc.dim(`  Not enough text to score (${summary.totalWords} words).`))
  }

  const fixable = summary.files.reduce(
    (sum, f) => sum + f.result.flags.filter((flag) => flag.fix).length,
    0,
  )
  if (fixable > 0) lines.push(pc.dim(`  ${fixable} fixable with --fix`))
  lines.push(
    pc.dim(
      `  ${summary.files.length} file${summary.files.length === 1 ? '' : 's'}, ${summary.totalFlags} flag${summary.totalFlags === 1 ? '' : 's'}, ${summary.totalWords} words`,
    ),
  )
  lines.push('')

  return lines.join('\n')
}
