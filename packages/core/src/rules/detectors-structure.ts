/**
 * Structural detectors for tells that live above the word level: scope disclaimers stacked one
 * after another, "X, not Y" contrasts, bold used as a highlighter, and paragraphs too long to
 * skim. None of these need a banned word, which is why a lexical rule set scores such text 100.
 *
 * Same contract as detectors.ts: pure, deterministic, parameters come from rule data.
 */

import type { Detector, DetectorContext } from './detectors.ts'
import type { Match } from './match.ts'

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/** Match covering the flat range `[start, end)`, snapped to the tokens it touches. */
function matchOfRange(context: DetectorContext, start: number, end: number): Match | undefined {
  let startToken = -1
  let endToken = -1
  for (let i = 0; i < context.tokens.length; i++) {
    const token = context.tokens[i]!
    if (token.end <= start) continue
    if (token.start >= end) break
    if (startToken === -1) startToken = i
    endToken = i + 1
  }
  if (startToken === -1) return undefined
  return { start, end, startToken, endToken, text: context.text.slice(start, end) }
}

const NEGATION =
  /\b(?:is|are|was|were|does|do|did|has|have|can|could|will|would|must|should|may)\s+(?:not|never)\b|\b(?:isn't|aren't|wasn't|doesn't|don't|didn't|can't|cannot|won't|shouldn't|mustn't)\b/
const SCOPE_WORDS =
  /\b(?:claim\w*|guarantee\w*|impl(?:y|ies|ied)|prov(?:e|es|en)|establish\w*|certif\w*|replac\w+|substitut\w+|forecast\w*|representative|comparable|like-for-like|equivalent|production-ready|coverage|widen\w*|reported|cited|counted|treated|interchangeable)\b/
const NO_CLAIMED =
  /\bno\b[^.;]{0,70}\b(?:is|are|was|were)\s+(?:claimed|implied|made|asserted|promised)\b/
const NOT_A_CLAIM =
  /\bnot\s+(?:a|an|the)\s+[^.;,]{0,40}\b(?:claim|guarantee|certificate|forecast|comparison|benchmark|measurement|substitute|replacement|proof|verification)\b/
const MUST_NOT_BE =
  /\b(?:must|should)\s+not\s+be\s+(?:reported|cited|read|treated|compared|described|quoted)\b/

/**
 * "This is not a production guarantee." "No speed advantage is claimed." "X does not replace Y."
 * One scope note is honest. A document that ends most paragraphs with one reads as boilerplate,
 * so the rule's density setting decides when the run counts at full weight.
 */
const scopeDisclaimer: Detector = (context) => {
  const matches: Match[] = []
  for (const sentence of context.sentences) {
    const text = context.normalized.slice(sentence.start, sentence.end).toLowerCase()
    const hit =
      NO_CLAIMED.test(text) ||
      NOT_A_CLAIM.test(text) ||
      MUST_NOT_BE.test(text) ||
      (NEGATION.test(text) && SCOPE_WORDS.test(text))
    if (!hit) continue
    const match = matchOfRange(context, sentence.start, sentence.end)
    if (match) matches.push(match)
  }
  return matches
}

const TAIL_NOT = /[\w)\u00b4`'"],\s+not\s+(?:a|an|the|every|any|\d+|general|operational)\b/g
const NOT_THEN_IS =
  /\b(?:is|are|was|were)\s+not\s+[^.;]{3,80}[;,]\s+(?:it|this|they|these)\s+(?:is|are)\b/g

/** "A fast solver, not a toy." "It is not a benchmark; it is a smoke test." */
const notXContrast: Detector = (context) => {
  const matches: Match[] = []
  for (const sentence of context.sentences) {
    const text = context.normalized.slice(sentence.start, sentence.end)
    const lower = text.toLowerCase()
    for (const pattern of [NOT_THEN_IS, TAIL_NOT]) {
      pattern.lastIndex = 0
      const found = pattern.exec(lower)
      if (!found) continue
      // Report the "not ..." part of the match, not the word before the comma.
      const notAt = lower.indexOf('not', found.index)
      const from = pattern === TAIL_NOT ? sentence.start + notAt : sentence.start + found.index
      const to = Math.min(sentence.end, sentence.start + found.index + found[0].length)
      const match = matchOfRange(context, from, to)
      if (match) matches.push(match)
      break
    }
  }
  return matches
}

/**
 * Bold used as a highlighter. A block with several bold spans (a table row, a paragraph with
 * three bold phrases) has nothing left to stand out. Needs `Block.emphasis` from the adapter.
 */
const boldOveruse: Detector = (context, params) => {
  const spans = context.block.emphasis ?? []
  const minSpans = asNumber(params.minSpansPerBlock, 3)
  if (spans.length < minSpans) return []
  const matches: Match[] = []
  for (const [start, end] of spans) {
    const match = matchOfRange(context, start, end)
    if (match) matches.push(match)
  }
  return matches
}

/** A paragraph too long to skim. Flags its first sentence so the fix target is the opening. */
const denseParagraph: Detector = (context, params) => {
  const kind = context.block.kind
  if (kind !== 'paragraph' && kind !== 'blockquote' && kind !== 'listItem') return []
  const maxWords = asNumber(params.maxWords, 110)
  const total = context.sentences.reduce((sum, sentence) => sum + sentence.words, 0)
  if (total < maxWords) return []
  const first = context.sentences[0]
  if (!first) return []
  const match = matchOfRange(context, first.start, first.end)
  return match ? [match] : []
}

export const STRUCTURE_DETECTORS: Readonly<Record<string, Detector>> = Object.freeze({
  'scope-disclaimer': scopeDisclaimer,
  'not-x-contrast': notXContrast,
  'bold-overuse': boldOveruse,
  'dense-paragraph': denseParagraph,
})
