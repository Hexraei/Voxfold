/** Shields.io endpoint badge JSON, matching the CLI's `--badge` output shape exactly. */

import type { ProjectSummary } from './lint.ts'

export interface BadgeJson {
  schemaVersion: 1
  label: string
  message: string
  color: string
}

export function buildBadge(summary: ProjectSummary): BadgeJson {
  const value = summary.score?.value
  const grade = summary.score?.grade
  const color =
    value === undefined
      ? 'lightgrey'
      : value >= 90
        ? 'brightgreen'
        : value >= 80
          ? 'green'
          : value >= 70
            ? 'yellow'
            : value >= 60
              ? 'orange'
              : 'red'
  return {
    schemaVersion: 1,
    label: 'style',
    message: value === undefined ? 'n/a' : `${value} · ${grade}`,
    color,
  }
}
