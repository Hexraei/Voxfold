/** Mirrors the CLI's gate semantics (`cli.ts` gateExitCode): error-severity flags always fail;
 *  min-score/min-file-score are opt-in thresholds. */

import type { ProjectSummary } from './lint.ts'

export function gatePasses(
  summary: ProjectSummary,
  minScore: number | undefined,
  minFileScore: number | undefined,
): boolean {
  const hasError = summary.files.some((f) =>
    f.result.flags.some((flag) => flag.severity === 'error'),
  )
  if (hasError) return false

  if (minScore !== undefined) {
    if (summary.score === null || summary.score.value < minScore) return false
  }
  if (minFileScore !== undefined) {
    for (const { result } of summary.files) {
      if (result.score !== null && result.score.value < minFileScore) return false
    }
  }
  return true
}
