import type { Flag } from '@voxfold/core'
import { describe, expect, it } from 'vitest'
import { computeDelta } from '../src/delta.ts'
import type { FileResult, ProjectSummary } from '../src/lint.ts'

function makeFlag(ruleId: string, hash: string, severity: Flag['severity'] = 'warn'): Flag {
  return {
    ruleId,
    kind: 'mechanical',
    category: 'punctuation',
    severity,
    message: `${ruleId} found`,
    docs: 'https://example.com',
    blockId: 'b0',
    flatRange: [0, 1],
    sourceRanges: [{ start: 0, end: 1 }],
    text: 'x',
    contribution: 1,
    dense: false,
    editable: true,
    hash,
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

function file(path: string, flags: Flag[]): FileResult {
  return {
    path,
    document: { uri: path, format: 'markdown', blocks: [], directives: [] },
    result: {
      flags,
      score: null,
      stats: { words: 100, blocks: 1, contribution: 0 },
      ruleset: 'r@1',
    },
  }
}

describe('computeDelta', () => {
  it('identifies new and fixed flags by rule+hash identity, not array position', () => {
    const base = summary(
      [file('a.md', [makeFlag('em-dash', 'h1'), makeFlag('tricolon', 'h2')])],
      80,
    )
    const head = summary(
      [file('a.md', [makeFlag('em-dash', 'h1'), makeFlag('seamlessly', 'h3')])],
      75,
    )

    const delta = computeDelta(base, head)
    expect(delta.newFlags.map((f) => f.flag.ruleId)).toEqual(['seamlessly'])
    expect(delta.fixedFlags.map((f) => f.flag.ruleId)).toEqual(['tricolon'])
  })

  it('treats the same rule+hash in different files as distinct', () => {
    const base = summary([file('a.md', [makeFlag('em-dash', 'h1')])], 90)
    const head = summary(
      [file('a.md', [makeFlag('em-dash', 'h1')]), file('b.md', [makeFlag('em-dash', 'h1')])],
      85,
    )
    const delta = computeDelta(base, head)
    expect(delta.newFlags).toHaveLength(1)
    expect(delta.newFlags[0]?.path).toBe('b.md')
    expect(delta.fixedFlags).toHaveLength(0)
  })

  it('computes score delta and handles null scores', () => {
    const base = summary([], 80)
    const head = summary([], 72)
    expect(computeDelta(base, head).scoreDelta).toBe(-8)

    const baseNull = summary([], null)
    expect(computeDelta(baseNull, head).scoreDelta).toBeNull()
  })

  it('tallies category counts from head flags only', () => {
    const base = summary([file('a.md', [makeFlag('em-dash', 'h1')])], 80)
    const head = summary([file('a.md', [makeFlag('em-dash', 'h1'), makeFlag('em-dash', 'h4')])], 70)
    const delta = computeDelta(base, head)
    expect(delta.categoryCounts.get('punctuation')).toBe(2)
  })
})
