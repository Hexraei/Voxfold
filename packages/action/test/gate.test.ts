import type { Flag } from '@voxfold/core'
import { describe, expect, it } from 'vitest'
import { gatePasses } from '../src/gate.ts'
import type { FileResult, ProjectSummary } from '../src/lint.ts'

function makeFlag(severity: Flag['severity']): Flag {
  return {
    ruleId: 'x',
    kind: 'mechanical',
    category: 'punctuation',
    severity,
    message: 'm',
    docs: 'd',
    blockId: 'b0',
    flatRange: [0, 1],
    sourceRanges: [],
    text: 'x',
    contribution: 1,
    dense: false,
    editable: true,
    hash: 'h',
  }
}

function file(flags: Flag[], scoreValue: number | null): FileResult {
  return {
    path: 'a.md',
    document: { uri: 'a.md', format: 'markdown', blocks: [], directives: [] },
    result: {
      flags,
      score:
        scoreValue === null
          ? null
          : { value: scoreValue, grade: 'B', tellsPer100: 1, words: 100, ruleset: 'r@1' },
      stats: { words: 100, blocks: 1, contribution: 0 },
      ruleset: 'r@1',
    },
  }
}

function summary(files: FileResult[], scoreValue: number | null): ProjectSummary {
  return {
    files,
    score:
      scoreValue === null
        ? null
        : { value: scoreValue, grade: 'B', tellsPer100: 1, words: 100, ruleset: 'r@1' },
    totalWords: 100,
    totalFlags: files.reduce((n, f) => n + f.result.flags.length, 0),
  }
}

describe('gatePasses', () => {
  it('fails on any error-severity flag regardless of score', () => {
    const s = summary([file([makeFlag('error')], 100)], 100)
    expect(gatePasses(s, undefined, undefined)).toBe(false)
  })

  it('passes with no thresholds and no errors', () => {
    const s = summary([file([makeFlag('warn')], 90)], 90)
    expect(gatePasses(s, undefined, undefined)).toBe(true)
  })

  it('fails when project score is below min-score', () => {
    const s = summary([file([], 70)], 70)
    expect(gatePasses(s, 80, undefined)).toBe(false)
    expect(gatePasses(s, 60, undefined)).toBe(true)
  })

  it('fails when any file score is below min-file-score', () => {
    const s = summary([file([], 50), file([], 95)], 75)
    expect(gatePasses(s, undefined, 60)).toBe(false)
    expect(gatePasses(s, undefined, 40)).toBe(true)
  })
})
