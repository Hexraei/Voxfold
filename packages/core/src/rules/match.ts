/**
 * Matchers: rule data → matches over a tokenized block.
 *
 * Everything here works on the flat block text and its tokens, so a match range feeds straight
 * into OffsetMap.toSourceRanges. Matching is done against the normalized forms, so "doesn’t"
 * and "doesn't" behave the same without the source ever being rewritten.
 */

import { normalizeForMatch } from '../text/normalize.ts'
import type { TaggedToken } from '../text/tagger.ts'
import { isWordToken, type Token } from '../text/tokenize.ts'
import type {
  CharsMatcher,
  Matcher,
  PhrasesMatcher,
  RegexMatcher,
  TokenPatternStep,
  TokensMatcher,
  WordsMatcher,
} from './schema.ts'

/** One hit: a flat range plus the tokens it covers. */
export interface Match {
  start: number
  end: number
  /** Token indices `[startToken, endToken)`. */
  startToken: number
  endToken: number
  /** Text matched, exactly as it appears in the block. */
  text: string
}

export interface MatchContext {
  text: string
  tokens: readonly Token[]
  tagged: readonly TaggedToken[]
  /** Normalized copy of `text`, same length, so indices are interchangeable. */
  normalized: string
}

export function createMatchContext(
  text: string,
  tokens: readonly Token[],
  tagged: readonly TaggedToken[],
): MatchContext {
  return { text, tokens, tagged, normalized: normalizeForMatch(text) }
}

function matchFromTokens(context: MatchContext, startToken: number, endToken: number): Match {
  const first = context.tokens[startToken]!
  const last = context.tokens[endToken - 1]!
  return {
    start: first.start,
    end: last.end,
    startToken,
    endToken,
    text: context.text.slice(first.start, last.end),
  }
}

/** Token index whose range contains `offset`, or -1. */
function tokenIndexAt(context: MatchContext, offset: number): number {
  const tokens = context.tokens
  let lo = 0
  let hi = tokens.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const token = tokens[mid]!
    if (offset < token.start) hi = mid - 1
    else if (offset >= token.end) lo = mid + 1
    else return mid
  }
  return -1
}

/** Build a match from a flat range, snapping to the tokens it overlaps. */
function matchFromRange(context: MatchContext, start: number, end: number): Match | undefined {
  const startToken = tokenIndexAt(context, start)
  const endToken = tokenIndexAt(context, Math.max(start, end - 1))
  if (startToken === -1 || endToken === -1) return undefined
  return {
    start,
    end,
    startToken,
    endToken: endToken + 1,
    text: context.text.slice(start, end),
  }
}

function matchWords(context: MatchContext, matcher: WordsMatcher): Match[] {
  const wanted = new Set(matcher.words.map((word) => normalizeForMatch(word)))
  const matches: Match[] = []

  for (let i = 0; i < context.tokens.length; i++) {
    const token = context.tokens[i]!
    if (!isWordToken(token)) continue
    if (!wanted.has(token.norm)) continue
    if (matcher.tag && context.tagged[i]?.tag !== matcher.tag) continue
    matches.push(matchFromTokens(context, i, i + 1))
  }
  return matches
}

/**
 * Phrases match across whitespace runs of any length, so a phrase split over a line break in the
 * source still matches. Punctuation inside a phrase must be written into the phrase itself.
 */
function matchPhrases(context: MatchContext, matcher: PhrasesMatcher): Match[] {
  const matches: Match[] = []

  for (const phrase of matcher.phrases) {
    const parts = normalizeForMatch(phrase).trim().split(/\s+/)
    if (parts.length === 0) continue

    for (let i = 0; i < context.tokens.length; i++) {
      const consumed = matchPhraseAt(context, parts, i)
      if (consumed !== undefined) matches.push(matchFromTokens(context, i, consumed))
    }
  }
  return matches
}

/** Try to match `parts` starting at token `index`; returns the exclusive end token index. */
function matchPhraseAt(
  context: MatchContext,
  parts: readonly string[],
  index: number,
): number | undefined {
  let tokenIndex = index
  for (let part = 0; part < parts.length; part++) {
    // Skip whitespace between phrase words, but never before the first one: that would let a
    // phrase match starting mid-gap and report a range with leading space.
    if (part > 0) {
      while (context.tokens[tokenIndex]?.type === 'whitespace') tokenIndex++
    }
    const token = context.tokens[tokenIndex]
    if (!token) return undefined

    const wanted = parts[part]!
    // A phrase word may itself be several tokens ("it's" is one, "fast-paced" is one, but
    // "world," is a word plus punctuation), so consume greedily by string comparison.
    let consumedText = ''
    let consumedTokens = 0
    while (consumedText.length < wanted.length) {
      const next = context.tokens[tokenIndex + consumedTokens]
      if (!next || next.type === 'whitespace') return undefined
      consumedText += next.norm
      consumedTokens++
    }
    if (consumedText !== wanted) return undefined
    tokenIndex += consumedTokens
  }
  return tokenIndex
}

function matchChars(context: MatchContext, matcher: CharsMatcher): Match[] {
  const matches: Match[] = []
  for (const chars of matcher.chars) {
    const needle = normalizeForMatch(chars)
    if (needle.length === 0) continue
    let from = 0
    for (;;) {
      const index = context.normalized.indexOf(needle, from)
      if (index === -1) break
      const match = matchFromRange(context, index, index + needle.length)
      if (match) matches.push(match)
      from = index + needle.length
    }
  }
  return matches
}

function matchRegex(context: MatchContext, matcher: RegexMatcher): Match[] {
  const flags = new Set((matcher.flags ?? '').split(''))
  flags.add('g')
  flags.add('u')
  const regex = new RegExp(matcher.pattern, [...flags].join(''))
  const matches: Match[] = []

  for (const found of context.normalized.matchAll(regex)) {
    if (found.index === undefined) continue
    const match = matchFromRange(context, found.index, found.index + found[0].length)
    if (match) matches.push(match)
  }
  return matches
}

/** True when `tagged` satisfies one step of a token pattern. */
function stepMatches(tagged: TaggedToken | undefined, step: TokenPatternStep): boolean {
  if (!tagged) return false
  const token = tagged.token
  if (token.type === 'whitespace' || token.type === 'placeholder') return false

  let ok = true
  if (step.word) ok &&= step.word.some((word) => normalizeForMatch(word) === token.norm)
  if (ok && step.lemma) ok &&= step.lemma.some((lemma) => normalizeForMatch(lemma) === tagged.lemma)
  if (ok && step.tag) ok &&= tagged.tag === step.tag
  if (ok && step.animate !== undefined) ok &&= tagged.animate === step.animate
  return step.not ? !ok : ok
}

/**
 * Token pattern matching: a small deliberate DSL rather than the tagger's own match syntax, so
 * swapping taggers never invalidates a rule file. Greedy with no backtracking, which is enough
 * for the shapes these rules describe and keeps behaviour easy to predict.
 */
function matchTokens(context: MatchContext, matcher: TokensMatcher): Match[] {
  const matches: Match[] = []
  const significant: number[] = []
  for (let i = 0; i < context.tokens.length; i++) {
    const type = context.tokens[i]!.type
    if (type !== 'whitespace') significant.push(i)
  }

  for (let start = 0; start < significant.length; start++) {
    let cursor = start
    let ok = true

    for (const step of matcher.tokens) {
      let matchedHere = 0
      while (
        cursor < significant.length &&
        stepMatches(context.tagged[significant[cursor]!], step)
      ) {
        cursor++
        matchedHere++
        if (!step.repeat) break
      }
      if (matchedHere === 0 && !step.optional) {
        ok = false
        break
      }
    }

    if (ok && cursor > start) {
      matches.push(matchFromTokens(context, significant[start]!, significant[cursor - 1]! + 1))
    }
  }
  return matches
}

/** Run one matcher. Detector matchers are handled by the engine, which owns the registry. */
export function runMatcher(context: MatchContext, matcher: Matcher): Match[] {
  switch (matcher.type) {
    case 'words':
      return matchWords(context, matcher)
    case 'phrases':
      return matchPhrases(context, matcher)
    case 'chars':
      return matchChars(context, matcher)
    case 'regex':
      return matchRegex(context, matcher)
    case 'tokens':
      return matchTokens(context, matcher)
    case 'detector':
      throw new Error(`detector matchers are dispatched by the engine, not runMatcher`)
  }
}

/** Drop duplicate and overlapping matches, keeping the earliest and longest. */
export function dedupe(matches: readonly Match[]): Match[] {
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end)
  const kept: Match[] = []
  for (const match of sorted) {
    const previous = kept[kept.length - 1]
    if (previous && match.start < previous.end) continue
    kept.push(match)
  }
  return kept
}
