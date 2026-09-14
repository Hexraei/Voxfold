/**
 * Scoring: pure arithmetic, never a model.
 *
 * tells per 100 words → an exponential curve → 0..100, where 100 is clean. It is called a style
 * score, never an AI-detection probability: the tool measures surface patterns and claims
 * nothing about who or what wrote the text.
 *
 * The curve constant and grade cut-offs are fitted against `corpus/human/` and
 * `corpus/ai-style/` by `scripts/calibrate/run.js`; see `corpus/CALIBRATION.md` for the method
 * and the numbers behind the current fit. Re-run that script and commit the result whenever a
 * rule-set change shifts scores on the corpus enough to matter.
 */

import calibrationData from './score/calibration.json' with { type: 'json' }

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F'

export interface Calibration {
  /** Curve constant: larger τ is more forgiving. score = 100 · e^(−tellsPer100 / τ). */
  tau: number
  /** Lowest score earning each grade. */
  cutoffs: { A: number; B: number; C: number; D: number }
  /** Below this many words a document is not scored at all: too little text to judge. */
  minWords: number
}

/** Fitted by `scripts/calibrate/run.js`; see `corpus/CALIBRATION.md`. */
export const DEFAULT_CALIBRATION: Calibration = Object.freeze({
  tau: calibrationData.tau,
  cutoffs: calibrationData.cutoffs,
  minWords: calibrationData.minWords,
})

export interface Score {
  value: number
  grade: Grade
  tellsPer100: number
  words: number
  /** Identity of the rules and tagger that produced this number, e.g. `rules@1.0.0+compromise@14.17.0`. */
  ruleset: string
}

export function gradeFor(value: number, calibration: Calibration = DEFAULT_CALIBRATION): Grade {
  const { cutoffs } = calibration
  if (value >= cutoffs.A) return 'A'
  if (value >= cutoffs.B) return 'B'
  if (value >= cutoffs.C) return 'C'
  if (value >= cutoffs.D) return 'D'
  return 'F'
}

export interface ScoreInput {
  /** Summed rule weights, after density and block weighting. */
  contribution: number
  words: number
  ruleset: string
}

/**
 * Score a document, or return null when there is too little text.
 *
 * Returning null rather than a flattering 100 matters: a 12-word page with one em dash would
 * otherwise score 0 and a 12-word clean page 100, and neither number means anything.
 */
export function computeScore(
  input: ScoreInput,
  calibration: Calibration = DEFAULT_CALIBRATION,
): Score | null {
  if (input.words < calibration.minWords) return null

  const tellsPer100 = (input.contribution / input.words) * 100
  const raw = 100 * Math.exp(-tellsPer100 / calibration.tau)
  // Round half up deterministically; Math.round is already half-up for positive values.
  const value = Math.max(0, Math.min(100, Math.round(raw)))

  return {
    value,
    grade: gradeFor(value, calibration),
    tellsPer100: Math.round(tellsPer100 * 1000) / 1000,
    words: input.words,
    ruleset: input.ruleset,
  }
}

/**
 * Combine per-file results the way `--min-score` does: weight by words, so one short page cannot
 * swing a project's score.
 */
export function combineScores(
  parts: ReadonlyArray<{ contribution: number; words: number }>,
  ruleset: string,
  calibration: Calibration = DEFAULT_CALIBRATION,
): Score | null {
  let contribution = 0
  let words = 0
  for (const part of parts) {
    contribution += part.contribution
    words += part.words
  }
  return computeScore({ contribution, words, ruleset }, calibration)
}
