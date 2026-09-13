/**
 * Tokenizer over a flattened block string.
 *
 * Offsets are UTF-16 code unit indices into the block text, so a token range feeds straight
 * into OffsetMap.toSourceRanges. Tokens carry both the raw slice and its normalized form, so
 * rules can match "doesn't" against "doesn’t" without the text ever being rewritten.
 */

import { PLACEHOLDER_CHAR } from '../types.ts'
import { normalizeForMatch } from './normalize.ts'

export type TokenType = 'word' | 'number' | 'punctuation' | 'whitespace' | 'placeholder'

export interface Token {
  type: TokenType
  /** Exact slice of the block text. */
  raw: string
  /** Comparison form: lower-cased, lookalike punctuation folded. Same length as `raw`. */
  norm: string
  start: number
  end: number
  /** Index of this token in the token list. */
  index: number
}

/**
 * Word characters: letters and digits from any script, plus the marks that sit inside words.
 * Intra-word apostrophes and hyphens are handled by the scanner, not this class.
 */
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u

/** Apostrophes that can sit inside a word: don't, doesn’t. */
const INNER_APOSTROPHE = /['‘’ʼ]/u

const WHITESPACE = /\s/u

const DIGIT = /\p{N}/u

/** True when the character at `index` continues the word starting before it. */
function continuesWord(text: string, index: number): boolean {
  const char = text[index]
  if (char === undefined) return false
  if (WORD_CHAR.test(char)) return true

  // An apostrophe or hyphen only stays inside the word when a letter follows it:
  // "don't" and "state-of-the-art" are one word, "ships -- fast" and "clients'" are not.
  if (INNER_APOSTROPHE.test(char) || char === '-') {
    const next = text[index + 1]
    return next !== undefined && WORD_CHAR.test(next)
  }

  // A separator stays inside a number only with digits on both sides: "3.5", "1,000", "12:30"
  // are one token, while the period in "ship 3. Then" ends the sentence.
  if (char === '.' || char === ',' || char === ':') {
    const previous = text[index - 1]
    const next = text[index + 1]
    return previous !== undefined && next !== undefined && DIGIT.test(previous) && DIGIT.test(next)
  }
  return false
}

/** Split a block's flat text into tokens. Every code unit belongs to exactly one token. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  const push = (type: TokenType, start: number, end: number): void => {
    const raw = text.slice(start, end)
    tokens.push({ type, raw, norm: normalizeForMatch(raw), start, end, index: tokens.length })
  }

  while (i < text.length) {
    const char = text[i]!

    if (char === PLACEHOLDER_CHAR) {
      push('placeholder', i, i + 1)
      i += 1
      continue
    }

    if (WHITESPACE.test(char)) {
      const start = i
      while (i < text.length && WHITESPACE.test(text[i]!) && text[i] !== PLACEHOLDER_CHAR) i++
      push('whitespace', start, i)
      continue
    }

    if (WORD_CHAR.test(char)) {
      const start = i
      i++
      while (i < text.length && continuesWord(text, i)) i++
      const raw = text.slice(start, i)
      // "3", "3.5" and "1,000" are numbers; "v2" and "H1" are words.
      push(/^\p{N}[\p{N}.,:]*$/u.test(raw) ? 'number' : 'word', start, i)
      continue
    }

    // Punctuation runs of the same character group together ("..." and "!!" are one token),
    // which is what the density rules count.
    const start = i
    i++
    while (i < text.length && text[i] === char) i++
    push('punctuation', start, i)
  }

  return tokens
}

/** Tokens that count toward the word count: real words and numbers, not placeholders. */
export function isWordToken(token: Token): boolean {
  return token.type === 'word' || token.type === 'number'
}

/** Number of words in a token list, excluding placeholders, punctuation and whitespace. */
export function countWords(tokens: readonly Token[]): number {
  let count = 0
  for (const token of tokens) if (isWordToken(token)) count++
  return count
}
