/** Renders the sticky PR comment body. Marker lets re-runs find and update it instead of
 *  posting duplicates on every push. */

import type { Delta } from './delta.ts'
import type { ProjectSummary } from './lint.ts'

export const STICKY_MARKER = '<!-- voxfold:sticky -->'

function arrow(delta: number | null): string {
  if (delta === null) return ''
  if (delta > 0) return ` (+${delta} ▲)`
  if (delta < 0) return ` (${delta} ▼)`
  return ' (±0)'
}

function scoreLine(summary: ProjectSummary, delta: Delta): string {
  if (summary.score === null) return '**Style score:** n/a (not enough text to score)'
  return `**Style score:** ${summary.score.value}/100 (${summary.score.grade})${arrow(delta.scoreDelta)}`
}

function topCategories(delta: Delta, limit = 5): string {
  const sorted = [...delta.categoryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
  if (sorted.length === 0) return '_No flags._'
  return sorted.map(([category, count]) => `- \`${category}\`: ${count}`).join('\n')
}

export function renderComment(summary: ProjectSummary, delta: Delta): string {
  const lines: string[] = [
    STICKY_MARKER,
    '## Voxfold style report',
    '',
    scoreLine(summary, delta),
    '',
    `New flags: **${delta.newFlags.length}**  ·  Fixed flags: **${delta.fixedFlags.length}**`,
    '',
    '### Top categories',
    topCategories(delta),
  ]
  return lines.join('\n')
}
