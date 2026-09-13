import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { equalsNormalized, normalizeForMatch } from '../src/text/normalize'
import { splitSentences } from '../src/text/sentences'
import { countWords, tokenize } from '../src/text/tokenize'
import { PLACEHOLDER_CHAR } from '../src/types'

const words = (text: string) => tokenize(text).filter((t) => t.type === 'word')

describe('normalizeForMatch', () => {
  it('folds apostrophes, dashes, quotes and spaces without changing length', () => {
    expect(normalizeForMatch('Doesn’t')).toBe("doesn't")
    expect(normalizeForMatch('a – b')).toBe('a — b')
    expect(normalizeForMatch('“quoted”')).toBe('"quoted"')
    expect(normalizeForMatch('a b')).toBe('a b')
  })

  it('preserves length for every input, so offsets stay valid', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        expect(normalizeForMatch(text).length).toBe(text.length)
      }),
      { numRuns: 2000 },
    )
  })

  it('does not break joined emoji sequences', () => {
    // The zero-width joiner holds 👩‍💻 together. Folding it inside the sequence would change
    // the match key's meaning; length must survive either way.
    const joined = '👩‍💻 ships code'
    expect(normalizeForMatch(joined).length).toBe(joined.length)
    expect(normalizeForMatch(joined).endsWith(' ships code')).toBe(true)
  })

  it('leaves characters whose lowercase form is longer alone', () => {
    // U+0130 lowercases to two code units; folding it would shift every later offset.
    expect(normalizeForMatch('İ').length).toBe(1)
    expect(equalsNormalized('It’s', "it's")).toBe(true)
  })
})

describe('tokenize', () => {
  it('keeps contractions and hyphenated words as single words', () => {
    expect(words("It doesn't ship state-of-the-art tooling").map((t) => t.raw)).toEqual([
      'It',
      "doesn't",
      'ship',
      'state-of-the-art',
      'tooling',
    ])
  })

  it('treats a trailing apostrophe and spaced dashes as punctuation', () => {
    expect(words("our clients' needs").map((t) => t.raw)).toEqual(['our', 'clients', 'needs'])
    expect(
      tokenize('ships -- fast')
        .filter((t) => t.type === 'punctuation')
        .map((t) => t.raw),
    ).toEqual(['--'])
  })

  it('classifies numbers apart from words', () => {
    const types = tokenize('v2 ships 3.5 times in 1,000 days').filter(
      (t) => t.type !== 'whitespace',
    )
    expect(types.map((t) => `${t.type}:${t.raw}`)).toEqual([
      'word:v2',
      'word:ships',
      'number:3.5',
      'word:times',
      'word:in',
      'number:1,000',
      'word:days',
    ])
  })

  it('groups runs of the same punctuation, which is what density rules count', () => {
    const punct = tokenize('Wait... really?!').filter((t) => t.type === 'punctuation')
    expect(punct.map((t) => t.raw)).toEqual(['...', '?', '!'])
  })

  it('emits placeholders as their own token and excludes them from the word count', () => {
    const tokens = tokenize(`Run ${PLACEHOLDER_CHAR} to install`)
    expect(tokens.find((t) => t.type === 'placeholder')?.raw).toBe(PLACEHOLDER_CHAR)
    expect(countWords(tokens)).toBe(3)
  })

  it('covers every code unit exactly once, in order', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (text) => {
        const tokens = tokenize(text)
        let cursor = 0
        for (const token of tokens) {
          expect(token.start).toBe(cursor)
          expect(token.raw).toBe(text.slice(token.start, token.end))
          expect(token.norm.length).toBe(token.raw.length)
          cursor = token.end
        }
        expect(cursor).toBe(text.length)
      }),
      { numRuns: 2000 },
    )
  })
})

describe('splitSentences', () => {
  const split = (text: string) => splitSentences(text, tokenize(text)).map((s) => s.text)

  it('splits a tricolon into three one-word sentences', () => {
    const sentences = splitSentences('Fast. Simple. Secure.', tokenize('Fast. Simple. Secure.'))
    expect(sentences.map((s) => s.text)).toEqual(['Fast.', 'Simple.', 'Secure.'])
    expect(sentences.every((s) => s.words === 1)).toBe(true)
  })

  it('keeps "not just X, it\'s Y" in one sentence', () => {
    expect(split("It's not just a tool, it's a workflow.")).toEqual([
      "It's not just a tool, it's a workflow.",
    ])
  })

  it('does not split on abbreviations, initials, decimals, versions or domains', () => {
    expect(split('Ship v1.2 today. Then rest.')).toEqual(['Ship v1.2 today.', 'Then rest.'])
    expect(split('Visit example.com for docs.')).toEqual(['Visit example.com for docs.'])
    expect(split('Dr. Smith wrote it.')).toEqual(['Dr. Smith wrote it.'])
    expect(split('J. R. R. Tolkien wrote it.')).toEqual(['J. R. R. Tolkien wrote it.'])
    expect(split('It costs 3.5 credits.')).toEqual(['It costs 3.5 credits.'])
  })

  it('absorbs closing quotes into the sentence they end', () => {
    expect(split('He said "go." Then left.')).toEqual(['He said "go."', 'Then left.'])
  })

  it('reports offsets that slice back to the sentence text', () => {
    const text = 'Fast. Simple. Secure.'
    for (const sentence of splitSentences(text, tokenize(text))) {
      expect(text.slice(sentence.start, sentence.end)).toBe(sentence.text)
    }
  })

  it('returns sentences covering the text in order, never overlapping', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (text) => {
        const sentences = splitSentences(text, tokenize(text))
        let previousEnd = -1
        for (const sentence of sentences) {
          expect(sentence.start).toBeGreaterThan(previousEnd - 1)
          expect(sentence.end).toBeGreaterThan(sentence.start)
          expect(text.slice(sentence.start, sentence.end)).toBe(sentence.text)
          previousEnd = sentence.end
        }
      }),
      { numRuns: 2000 },
    )
  })
})
