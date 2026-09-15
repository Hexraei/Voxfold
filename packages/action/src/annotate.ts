/**
 * Workflow-command annotations, restricted to lines the PR's diff actually touches. A file can
 * carry pre-existing flags outside the diff; annotating those would be noisy on every PR that
 * merely touches a file with unrelated history, so each flag's line is checked against the
 * hunk ranges parsed from `git diff` before it is emitted.
 */

import { type DiffHunk, lineInHunks } from './git.ts'
import type { FileResult } from './lint.ts'

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

export interface Annotation {
  level: 'warning' | 'error'
  file: string
  line: number
  title: string
  message: string
}

export function annotationsInDiff(
  files: readonly FileResult[],
  hunksByFile: ReadonlyMap<string, DiffHunk[]>,
): Annotation[] {
  const annotations: Annotation[] = []
  for (const { path, document, result } of files) {
    const hunks = hunksByFile.get(path)
    if (!hunks) continue
    for (const flag of result.flags) {
      const line = lineOf(document.source, flag.sourceRanges[0]?.start ?? 0)
      if (!lineInHunks(hunks, line)) continue
      annotations.push({
        level: flag.severity === 'error' ? 'error' : 'warning',
        file: path,
        line,
        title: `voxfold/${flag.ruleId}`,
        message: flag.message,
      })
    }
  }
  return annotations
}

export function formatAnnotation(a: Annotation): string {
  return `::${a.level} file=${a.file},line=${a.line},title=${a.title}::${escapeWorkflowCommand(a.message)}`
}
