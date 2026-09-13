/**
 * Rule-based sentence splitter.
 *
 * Several tells are defined per sentence ("Fast. Simple. Secure." is three sentences of one word
 * each; "not just X, it's Y" must stay inside one), so the split has to be predictable. It is
 * deliberately conservative: when a boundary is ambiguous, keep the text together rather than
 * inventing a split that would change what rules see.
 */

import { isWordToken, type Token } from './tokenize.ts'

export interface Sentence {
  /** Token indices `[startToken, endToken)` covering this sentence, whitespace included. */
  startToken: number
  endToken: number
  /** Flat text offsets of the trimmed sentence. */
  start: number
  end: number
  text: string
  /** Word tokens in this sentence. */
  words: number
}

/**
 * Abbreviations whose trailing period does not end a sentence. Lower-cased, without the period.
 * Kept small and explicit: every entry is a judgement call, and data belongs in review.
 */
const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'vs',
  'etc',
  'eg',
  'ie',
  'no',
  'fig',
  'al',
  'approx',
  'inc',
  'ltd',
  'co',
  'corp',
  'dept',
  'est',
  'min',
  'max',
  'sec',
  'ver',
  'vol',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sept',
  'sep',
  'oct',
  'nov',
  'dec',
])

const TERMINATOR = /^[.!?]+$/
const CLOSING = /^["')\]}»”’]+$/

/** True when `token` is a single capital letter, as in "J. R. R. Tolkien". */
function isInitial(token: Token | undefined): boolean {
  return token !== undefined && token.type === 'word' && token.raw.length === 1
}

/**
 * True when the period at `index` is part of something that is not a sentence end:
 * an abbreviation, an initial, a decimal, a version number, or a domain/URL.
 */
function isFalseTerminator(tokens: readonly Token[], index: number): boolean {
  const token = tokens[index]!
  if (token.raw !== '.') return false

  const previous = tokens[index - 1]
  const next = tokens[index + 1]

  if (previous && isWordToken(previous)) {
    if (ABBREVIATIONS.has(previous.norm)) return true
    if (isInitial(previous)) return true
    // "example.com", "v1.2", "3.5": no space around the period means it is inside a token run.
    if (next && isWordToken(next)) return true
  }
  return false
}

/** Split a tokenized block into sentences. */
export function splitSentences(text: string, tokens: readonly Token[]): Sentence[] {
  const sentences: Sentence[] = []
  let startToken = 0

  const flush = (endToken: number): void => {
    // Trim leading and trailing whitespace tokens.
    let from = startToken
    let to = endToken
    while (from < to && tokens[from]!.type === 'whitespace') from++
    while (to > from && tokens[to - 1]!.type === 'whitespace') to--
    startToken = endToken
    if (from >= to) return

    let words = 0
    for (let i = from; i < to; i++) if (isWordToken(tokens[i]!)) words++

    const start = tokens[from]!.start
    const end = tokens[to - 1]!.end
    sentences.push({
      startToken: from,
      endToken: to,
      start,
      end,
      text: text.slice(start, end),
      words,
    })
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token.type !== 'punctuation' || !TERMINATOR.test(token.raw)) continue
    if (isFalseTerminator(tokens, i)) continue

    // Absorb closing quotes and brackets that belong to the sentence just ended.
    let end = i + 1
    while (end < tokens.length && CLOSING.test(tokens[end]!.raw)) end++

    // A terminator with no following text ends the final sentence.
    flush(end)
  }

  if (startToken < tokens.length) flush(tokens.length)
  return sentences
}
