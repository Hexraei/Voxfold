import type { Flag } from '@voxfold/core'
import { describe, expect, it } from 'vitest'
import { annotationsInDiff, formatAnnotation } from '../src/annotate.ts'
import type { FileResult } from '../src/lint.ts'

function makeFlag(overrides: Partial<Flag> & { sourceRanges: Flag['sourceRanges'] }): Flag {
  return {
    ruleId: 'em-dash',
    kind: 'mechanical',
    category: 'punctuation',
    severity: 'warn',
    message: 'em dash found',
    docs: 'https://example.com/em-dash',
    blockId: 'b0',
    flatRange: [0, 1],
    text: '—',
    contribution: 1,
    dense: false,
    editable: true,
    hash: 'abc123',
    ...overrides,
  }
}

function fileResult(path: string, source: string, flags: Flag[]): FileResult {
  return {
    path,
    document: { uri: path, format: 'markdown', source, blocks: [], directives: [] },
    result: {
      flags,
      score: null,
      stats: { words: 0, blocks: 0, contribution: 0 },
      ruleset: 'recommended@1.0.0',
    },
  }
}

describe('annotationsInDiff', () => {
  it('keeps flags whose line falls inside a diff hunk', () => {
    // line 1: "one\n", line 2: "two\n", line 3: "three"
    const source = 'one\ntwo\nthree'
    const flagOnLine2 = makeFlag({ sourceRanges: [{ start: 4, end: 5 }] }) // offset 4 = start of "two"
    const file = fileResult('a.md', source, [flagOnLine2])
    const hunks = new Map([['a.md', [{ newStart: 2, newEnd: 3 }]]])

    const result = annotationsInDiff([file], hunks)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ file: 'a.md', line: 2, level: 'warning' })
  })

  it('drops flags outside the diff hunks even when flagged', () => {
    const source = 'one\ntwo\nthree'
    const flagOnLine1 = makeFlag({ sourceRanges: [{ start: 0, end: 1 }] })
    const file = fileResult('a.md', source, [flagOnLine1])
    const hunks = new Map([['a.md', [{ newStart: 2, newEnd: 3 }]]]) // only line 2 changed

    const result = annotationsInDiff([file], hunks)
    expect(result).toHaveLength(0)
  })

  it('drops all flags for a file with no diff hunks at all (unchanged file)', () => {
    const source = 'one\ntwo\nthree'
    const flag = makeFlag({ sourceRanges: [{ start: 4, end: 5 }] })
    const file = fileResult('untouched.md', source, [flag])
    const hunks = new Map<string, Array<{ newStart: number; newEnd: number }>>()

    expect(annotationsInDiff([file], hunks)).toHaveLength(0)
  })

  it('maps error severity to ::error and warn to ::warning', () => {
    const source = 'one'
    const errorFlag = makeFlag({ severity: 'error', sourceRanges: [{ start: 0, end: 1 }] })
    const file = fileResult('a.md', source, [errorFlag])
    const hunks = new Map([['a.md', [{ newStart: 1, newEnd: 2 }]]])
    const [annotation] = annotationsInDiff([file], hunks)
    expect(annotation?.level).toBe('error')
  })
})

describe('formatAnnotation', () => {
  it('escapes % \\r \\n in the message', () => {
    const line = formatAnnotation({
      level: 'warning',
      file: 'a.md',
      line: 3,
      title: 'voxfold/em-dash',
      message: '100% sure\r\nreally',
    })
    expect(line).toBe('::warning file=a.md,line=3,title=voxfold/em-dash::100%25 sure%0D%0Areally')
  })
})
