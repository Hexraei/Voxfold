/**
 * JSON formatter for scripting. `schemaVersion` lets a consumer detect a breaking shape change
 * without guessing from field presence; key order is fixed so output diffs cleanly.
 */

import type { ProjectSummary } from '../lint-runner.ts'
import { displayPath } from './display-path.ts'

const SCHEMA_VERSION = 1

export function formatJson(summary: ProjectSummary, cwd: string): string {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    score: summary.score,
    stats: {
      files: summary.files.length,
      flags: summary.totalFlags,
      words: summary.totalWords,
    },
    files: summary.files.map(({ file, result }) => ({
      path: displayPath(file, cwd),
      score: result.score,
      words: result.stats.words,
      flags: result.flags.map((flag) => ({
        ruleId: flag.ruleId,
        kind: flag.kind,
        category: flag.category,
        severity: flag.severity,
        message: flag.message,
        text: flag.text,
        sourceRanges: flag.sourceRanges,
        contribution: flag.contribution,
        dense: flag.dense,
        editable: flag.editable,
        fixable: Boolean(flag.fix),
        suggestions: flag.suggestions?.map((s) => s.label) ?? [],
      })),
    })),
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}
