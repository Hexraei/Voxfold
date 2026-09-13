/**
 * Built-in structural detectors.
 *
 * Some tells are shapes, not strings: three one-word sentences in a row, a contrast between what
 * something is not and what it is, an adverb attached to a thing that cannot act. Those need
 * code. Rules stay data by choosing a detector and supplying its parameters (word lists,
 * thresholds), so the taste decisions still live in YAML and only the mechanism lives here.
 *
 * Every detector is pure and deterministic: same block in, same matches out.
 */

import type { Sentence } from '../text/sentences.ts'
import { isWordToken } from '../text/tokenize.ts'
import type { Block } from '../types.ts'
import type { Match, MatchContext } from './match.ts'

export interface DetectorContext extends MatchContext {
  block: Block
  sentences: readonly Sentence[]
}

export type Detector = (context: DetectorContext, params: Record<string, unknown>) => Match[]

const asStrings = (value: unknown, fallback: string[]): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/** Significant (non-whitespace) token indices within a token range. */
function significantTokens(context: DetectorContext, from: number, to: number): number[] {
  const indices: number[] = []
  for (let i = from; i < to; i++) {
    if (context.tokens[i]!.type !== 'whitespace') indices.push(i)
  }
  return indices
}

function matchOfTokens(context: DetectorContext, startToken: number, endToken: number): Match {
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

/** Find a phrase (given as normalized words) within a token index range. */
function findPhrase(
  context: DetectorContext,
  words: readonly string[],
  from: number,
  to: number,
): { startToken: number; endToken: number } | undefined {
  const indices = significantTokens(context, from, to)
  for (let i = 0; i + words.length <= indices.length; i++) {
    let ok = true
    for (let w = 0; w < words.length; w++) {
      if (context.tokens[indices[i + w]!]!.norm !== words[w]) {
        ok = false
        break
      }
    }
    if (ok) {
      return { startToken: indices[i]!, endToken: indices[i + words.length - 1]! + 1 }
    }
  }
  return undefined
}

/**
 * "It's not just a tool, it's a workflow." — announce what something isn't, then what it is.
 *
 * Requires a negator followed by a pivot within `maxGap` significant tokens, inside one
 * sentence. "This is not just for admins; editors can use it too." has no pivot, so it passes.
 */
const contrastiveNegation: Detector = (context, params) => {
  const negators = asStrings(params.negators, [
    'not just',
    "isn't just",
    'not only',
    'more than just',
  ])
  const pivots = asStrings(params.pivots, ["it's", 'it is', 'but', 'but also'])
  const maxGap = asNumber(params.maxGap, 12)
  const matches: Match[] = []

  for (const sentence of context.sentences) {
    for (const negator of negators) {
      const negatorWords = negator.split(/\s+/)
      const found = findPhrase(context, negatorWords, sentence.startToken, sentence.endToken)
      if (!found) continue

      const searchFrom = found.endToken
      const significant = significantTokens(context, searchFrom, sentence.endToken)
      const limit = significant[maxGap] ?? sentence.endToken

      let best: { startToken: number; endToken: number } | undefined
      for (const pivot of pivots) {
        const pivotFound = findPhrase(context, pivot.split(/\s+/), searchFrom, limit)
        if (pivotFound && (!best || pivotFound.endToken < best.endToken)) best = pivotFound
      }
      if (!best) continue

      matches.push(matchOfTokens(context, found.startToken, best.endToken))
      break
    }
  }
  return matches
}

/**
 * "Fast. Simple. Secure." — three or more consecutive short fragments used for rhythm.
 *
 * Real instructions ("Install the CLI. Add a config. Run it.") are full sentences with verbs and
 * objects, so a word-count ceiling separates them. List items are excluded by rule config, since
 * three bullets are normal.
 */
const tricolonFragments: Detector = (context, params) => {
  const minRun = asNumber(params.minRun, 3)
  const maxWords = asNumber(params.maxWords, 2)
  const matches: Match[] = []

  let runStart = -1
  let runLength = 0

  const flush = (endIndex: number): void => {
    if (runLength >= minRun && runStart !== -1) {
      const first = context.sentences[runStart]!
      const last = context.sentences[endIndex - 1]!
      matches.push(matchOfTokens(context, first.startToken, last.endToken))
    }
    runStart = -1
    runLength = 0
  }

  for (let i = 0; i < context.sentences.length; i++) {
    const sentence = context.sentences[i]!
    const qualifies = sentence.words > 0 && sentence.words <= maxWords
    if (qualifies) {
      if (runStart === -1) runStart = i
      runLength++
    } else {
      flush(i)
    }
  }
  flush(context.sentences.length)
  return matches
}

/**
 * "No setup. No config. Just code." — the negation triplet: several short "No X." fragments
 * closed by a "Just Y." payoff.
 */
const negationTriplet: Detector = (context, params) => {
  const negators = asStrings(params.negators, ['no', 'never', 'zero'])
  const closers = asStrings(params.closers, ['just', 'only', 'simply'])
  const minNegations = asNumber(params.minNegations, 2)
  const matches: Match[] = []

  const firstWordOf = (sentence: Sentence): string | undefined => {
    for (let i = sentence.startToken; i < sentence.endToken; i++) {
      const token = context.tokens[i]!
      if (isWordToken(token)) return token.norm
    }
    return undefined
  }

  let runStart = -1
  let negations = 0

  for (let i = 0; i < context.sentences.length; i++) {
    const sentence = context.sentences[i]!
    const first = firstWordOf(sentence)
    if (first === undefined) continue

    if (negators.includes(first) && sentence.words <= 4) {
      if (runStart === -1) runStart = i
      negations++
      continue
    }
    if (negations >= minNegations && closers.includes(first) && sentence.words <= 5) {
      matches.push(
        matchOfTokens(context, context.sentences[runStart!]!.startToken, sentence.endToken),
      )
    }
    runStart = -1
    negations = 0
  }
  return matches
}

/**
 * "The best part? There isn't one." — a short rhetorical question answered immediately by the
 * writer. Real questions in docs ("Why does this fail? See below.") are longer, so a word
 * ceiling on the question keeps this narrow.
 */
const rhetoricalQa: Detector = (context, params) => {
  const maxQuestionWords = asNumber(params.maxQuestionWords, 5)
  const maxAnswerWords = asNumber(params.maxAnswerWords, 12)
  const matches: Match[] = []

  for (let i = 0; i < context.sentences.length - 1; i++) {
    const question = context.sentences[i]!
    const answer = context.sentences[i + 1]!
    if (!question.text.trimEnd().endsWith('?')) continue
    if (question.words === 0 || question.words > maxQuestionWords) continue
    if (answer.words === 0 || answer.words > maxAnswerWords) continue
    // A question ending a block has no answer to pair with; require the answer to be a statement.
    if (answer.text.trimEnd().endsWith('?')) continue
    matches.push(matchOfTokens(context, question.startToken, answer.endToken))
  }
  return matches
}

/**
 * "where design meets engineering" — the X-meets-Y formula.
 *
 * Both sides must read as things. A gerund counts: taggers routinely call "engineering" a verb,
 * and refusing it would miss the most common form of this slogan.
 */
const xMeetsY: Detector = (context, params) => {
  const verbs = asStrings(params.verbs, ['meets'])
  const matches: Match[] = []

  const nounish = (index: number | undefined): boolean => {
    if (index === undefined) return false
    const tagged = context.tagged[index]
    if (!tagged) return false
    if (tagged.tag === 'NOUN' || tagged.tag === 'PROPN') return true
    return tagged.tag === 'VERB' && tagged.token.norm.endsWith('ing')
  }

  for (let i = 0; i < context.tokens.length; i++) {
    const tagged = context.tagged[i]
    if (!tagged || !isWordToken(tagged.token)) continue
    if (!verbs.includes(tagged.token.norm)) continue

    const before = previousWord(context, i)
    const after = nextWord(context, i)
    if (!nounish(before) || !nounish(after)) continue
    matches.push(matchOfTokens(context, before!, after! + 1))
  }
  return matches
}

/**
 * "from startups to enterprises" — the range formula standing in for saying who it is for.
 *
 * A literal movement ("migrate from Postgres to MySQL") has the same shape, so verbs of motion
 * before the "from" rule it out. That list is rule data, not a hard-coded judgement.
 */
const fromXToY: Detector = (context, params) => {
  const maxGap = asNumber(params.maxGap, 4)
  const skipVerbs = new Set(
    asStrings(params.skipVerbs, [
      'migrate',
      'migrated',
      'migrating',
      'move',
      'moved',
      'moving',
      'convert',
      'converted',
      'switch',
      'switched',
      'upgrade',
      'upgraded',
      'port',
      'ported',
      'copy',
      'copied',
      'import',
      'imported',
      'export',
      'exported',
      'go',
      'going',
      'went',
    ]),
  )
  const matches: Match[] = []

  for (let i = 0; i < context.tokens.length; i++) {
    const token = context.tokens[i]!
    if (!isWordToken(token) || token.norm !== 'from') continue

    const preceding = previousWord(context, i)
    if (preceding !== undefined) {
      const precedingToken = context.tagged[preceding]
      if (precedingToken && skipVerbs.has(precedingToken.token.norm)) continue
    }

    const significant = significantTokens(context, i + 1, context.tokens.length)
    for (let step = 0; step < Math.min(maxGap, significant.length); step++) {
      const candidate = significant[step]!
      if (context.tokens[candidate]!.norm !== 'to') continue
      const after = nextWord(context, candidate)
      if (after === undefined) break
      const beforeTag = context.tagged[significant[step - 1] ?? -1]?.tag
      const afterTag = context.tagged[after]?.tag
      const nounish = (tag: string | undefined) => tag === 'NOUN' || tag === 'PROPN'
      if (nounish(beforeTag) && nounish(afterTag)) {
        matches.push(matchOfTokens(context, i, after + 1))
      }
      break
    }
  }
  return matches
}

/**
 * "Built for speed. Designed for teams." — two consecutive short sentences opening with
 * parallel participles.
 */
const parallelPair: Detector = (context, params) => {
  const openers = asStrings(params.openers, ['built', 'designed', 'made', 'crafted', 'engineered'])
  const maxWords = asNumber(params.maxWords, 6)
  const matches: Match[] = []

  const opensWith = (sentence: Sentence): string | undefined => {
    for (let i = sentence.startToken; i < sentence.endToken; i++) {
      const token = context.tokens[i]!
      if (isWordToken(token)) return token.norm
    }
    return undefined
  }

  for (let i = 0; i < context.sentences.length - 1; i++) {
    const first = context.sentences[i]!
    const second = context.sentences[i + 1]!
    const a = opensWith(first)
    const b = opensWith(second)
    if (!a || !b) continue
    if (!openers.includes(a) || !openers.includes(b)) continue
    if (first.words > maxWords || second.words > maxWords) continue
    matches.push(matchOfTokens(context, first.startToken, second.endToken))
  }
  return matches
}

/**
 * "The dashboard quietly syncs your data." — a manner adverb attached to something that cannot
 * act. The same adverb on a person ("She quietly left") is ordinary writing, which is exactly
 * why this needs part-of-speech information rather than a word list.
 */
const adverbInanimateSubject: Detector = (context, params) => {
  const adverbs = new Set(
    asStrings(params.adverbs, [
      'quietly',
      'gently',
      'silently',
      'gracefully',
      'elegantly',
      'thoughtfully',
      'beautifully',
      'intelligently',
      'patiently',
      'happily',
    ]),
  )
  const matches: Match[] = []

  for (let i = 0; i < context.tagged.length; i++) {
    const tagged = context.tagged[i]!
    if (tagged.tag !== 'ADV' || !adverbs.has(tagged.token.norm)) continue

    // The subject is the nearest preceding noun-ish word in the same sentence; a verb after the
    // adverb confirms this is "<subject> <adverb> <verb>" and not a trailing modifier.
    const sentence = context.sentences.find(
      (candidate) => i >= candidate.startToken && i < candidate.endToken,
    )
    if (!sentence) continue

    const subject = previousWord(context, i, sentence.startToken)
    const verb = nextWord(context, i, sentence.endToken)
    if (subject === undefined || verb === undefined) continue

    const subjectTagged = context.tagged[subject]!
    const verbTagged = context.tagged[verb]!
    if (verbTagged.tag !== 'VERB') continue
    if (subjectTagged.tag !== 'NOUN') continue
    if (subjectTagged.animate) continue

    matches.push(matchOfTokens(context, subject, verb + 1))
  }
  return matches
}

/** Index of the previous word token before `index`, within an optional lower bound. */
function previousWord(context: DetectorContext, index: number, from = 0): number | undefined {
  for (let i = index - 1; i >= from; i--) {
    const token = context.tokens[i]!
    if (isWordToken(token)) return i
    if (token.type === 'punctuation' && /[.!?;:]/.test(token.raw)) return undefined
  }
  return undefined
}

/** Index of the next word token after `index`, within an optional upper bound. */
function nextWord(context: DetectorContext, index: number, to?: number): number | undefined {
  const limit = to ?? context.tokens.length
  for (let i = index + 1; i < limit; i++) {
    const token = context.tokens[i]!
    if (isWordToken(token)) return i
    if (token.type === 'punctuation' && /[.!?;:]/.test(token.raw)) return undefined
  }
  return undefined
}

/** "🚀 Features" — decorative emoji opening a heading, the classic generated-README look. */
const emojiHeading: Detector = (context) => {
  if (context.block.kind !== 'heading') return []
  const match = /^\s*(\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*)/u.exec(context.text)
  if (!match) return []
  const start = match.index + (match[0].length - match[1]!.length)
  const end = start + match[1]!.length
  const startToken = context.tokens.findIndex((token) => token.start <= start && token.end > start)
  if (startToken === -1) return []
  const endToken = context.tokens.findIndex((token) => token.start < end && token.end >= end)
  return [matchOfTokens(context, startToken, (endToken === -1 ? startToken : endToken) + 1)]
}

/**
 * "**Fast:** ships in milliseconds" — a bolded lead-in opening a list item. One is a normal
 * definition list; the rule's density setting decides when a run of them reads as generated.
 */
const boldLeadInList: Detector = (context, params) => {
  if (context.block.kind !== 'listItem') return []
  const maxLeadWords = asNumber(params.maxLeadWords, 4)

  // The adapter marks emphasis with segment boundaries; the visible shape is "Lead: rest" or
  // "Lead - rest" at the very start of the item.
  const match = /^\s*([^:—-]{1,60}?)\s*[:—-]\s+\S/u.exec(context.text)
  if (!match) return []
  const lead = match[1]!
  const words = lead.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > maxLeadWords) return []

  const start = match.index + match[0].indexOf(lead)
  const end = start + lead.length
  const startToken = context.tokens.findIndex((token) => token.start <= start && token.end > start)
  const endToken = context.tokens.findIndex((token) => token.start < end && token.end >= end)
  if (startToken === -1) return []
  return [matchOfTokens(context, startToken, (endToken === -1 ? startToken : endToken) + 1)]
}

export const DETECTORS: Readonly<Record<string, Detector>> = Object.freeze({
  'contrastive-negation': contrastiveNegation,
  'tricolon-fragments': tricolonFragments,
  'negation-triplet': negationTriplet,
  'rhetorical-qa': rhetoricalQa,
  'x-meets-y': xMeetsY,
  'from-x-to-y': fromXToY,
  'parallel-pair': parallelPair,
  'adverb-inanimate-subject': adverbInanimateSubject,
  'emoji-heading': emojiHeading,
  'bold-lead-in-list': boldLeadInList,
})

export function getDetector(name: string): Detector | undefined {
  return DETECTORS[name]
}
