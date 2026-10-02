/**
 * Golden scores for the calibration corpus (`corpus/human/`, `corpus/ai-style/`).
 *
 * Pins the exact score of every corpus file against the current rule set and calibration. If a
 * rule change or a recalibration shifts any of these numbers, this test fails — that's the
 * point: per the build plan, score-affecting changes only ship in a minor version, with a
 * changelog entry, never silently. A failure here means either the change is expected (update
 * the expected scores here, bump the ruleset's minor version, and note it in the changeset) or
 * it's a regression that needs investigating before it ships.
 *
 * Re-run `node scripts/calibrate/run.js` after an intentional change; it reports the same numbers
 * this test checks.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lint, type ProseDocument } from '@voxfold/core'
import { recommended } from '@voxfold/rules-recommended'
import { describe, expect, it } from 'vitest'
import { markdownAdapter } from '../src/index'

const corpusRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'corpus')

function scoreFile(dir: string, file: string) {
  const text = readFileSync(join(dir, file), 'utf8')
  const document = markdownAdapter.extract(text, { uri: file }) as ProseDocument
  const result = lint(document, recommended)
  return { score: result.score?.value ?? null, grade: result.score?.grade ?? null }
}

describe('golden corpus scores', () => {
  it('scores every human sample at its pinned value', () => {
    const dir = join(corpusRoot, 'human')
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
    const scores = Object.fromEntries(files.sort().map((f) => [f, scoreFile(dir, f)]))
    expect(scores).toEqual({
      'api-reference.md': { score: 98, grade: 'A' },
      'changelog.md': { score: 100, grade: 'A' },
      'cli-help.md': { score: 96, grade: 'A' },
      'engineering-notes.md': { score: 97, grade: 'A' },
      'howto-guide.md': { score: 97, grade: 'A' },
      'project-readme.md': { score: 97, grade: 'A' },
    })
  })

  it('scores every ai-style sample at its pinned value', () => {
    const dir = join(corpusRoot, 'ai-style')
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
    const scores = Object.fromEntries(files.sort().map((f) => [f, scoreFile(dir, f)]))
    expect(scores).toEqual({
      'api-reference.md': { score: 7, grade: 'F' },
      'changelog.md': { score: 4, grade: 'F' },
      'cli-help.md': { score: 3, grade: 'F' },
      'engineering-notes.md': { score: 16, grade: 'F' },
      'howto-guide.md': { score: 9, grade: 'F' },
      'project-readme.md': { score: 5, grade: 'F' },
    })
  })

  it('keeps a wide separation between human and ai-style medians', () => {
    const humanDir = join(corpusRoot, 'human')
    const aiDir = join(corpusRoot, 'ai-style')
    const humanScores = readdirSync(humanDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => scoreFile(humanDir, f).score!)
      .sort((a, b) => a - b)
    const aiScores = readdirSync(aiDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => scoreFile(aiDir, f).score!)
      .sort((a, b) => a - b)

    const median = (values: number[]) => {
      const mid = Math.floor(values.length / 2)
      return values.length % 2 === 0 ? (values[mid - 1]! + values[mid]!) / 2 : values[mid]!
    }

    expect(median(humanScores)).toBeGreaterThanOrEqual(90)
    expect(median(aiScores)).toBeLessThan(20)
  })
})
