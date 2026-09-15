import { describe, expect, it } from 'vitest'
import { renderComment, STICKY_MARKER } from '../src/comment.ts'
import type { Delta } from '../src/delta.ts'
import type { ProjectSummary } from '../src/lint.ts'

function delta(overrides: Partial<Delta> = {}): Delta {
  return {
    scoreBefore: 80,
    scoreAfter: 75,
    scoreDelta: -5,
    newFlags: [],
    fixedFlags: [],
    categoryCounts: new Map(),
    ...overrides,
  }
}

function summary(scoreValue: number | null): ProjectSummary {
  return {
    files: [],
    score:
      scoreValue === null
        ? null
        : { value: scoreValue, grade: 'B', tellsPer100: 1, words: 200, ruleset: 'r@1' },
    totalWords: 200,
    totalFlags: 0,
  }
}

describe('renderComment', () => {
  it('includes the sticky marker as the first line', () => {
    const body = renderComment(summary(75), delta())
    expect(body.startsWith(STICKY_MARKER)).toBe(true)
  })

  it('shows a down arrow for a negative score delta', () => {
    const body = renderComment(summary(75), delta({ scoreDelta: -5 }))
    expect(body).toContain('(-5 ▼)')
  })

  it('shows an up arrow for a positive score delta', () => {
    const body = renderComment(summary(85), delta({ scoreDelta: 5 }))
    expect(body).toContain('(+5 ▲)')
  })

  it('handles a null score gracefully', () => {
    const body = renderComment(
      summary(null),
      delta({ scoreBefore: null, scoreAfter: null, scoreDelta: null }),
    )
    expect(body).toContain('n/a')
  })

  it('lists top categories by descending count', () => {
    const categoryCounts = new Map([
      ['punctuation', 3],
      ['hedging', 7],
    ])
    const body = renderComment(summary(75), delta({ categoryCounts }))
    const hedgingIdx = body.indexOf('hedging')
    const punctIdx = body.indexOf('punctuation')
    expect(hedgingIdx).toBeGreaterThan(-1)
    expect(hedgingIdx).toBeLessThan(punctIdx)
  })
})
