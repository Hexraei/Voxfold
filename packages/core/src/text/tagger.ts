/**
 * Part-of-speech tagging.
 *
 * This is a dictionary-and-rules tagger (compromise), not a model: no network, no API key, and
 * the same input always produces the same tags. It exists because some tells depend on a word's
 * role rather than its spelling:
 *
 *   "The dashboard quietly syncs your data."  → tell (a dashboard cannot be quiet)
 *   "She quietly left the room."              → normal writing
 *
 * The rest of the engine only ever sees the small tag set defined here, so the tagger can be
 * swapped without rewriting a single rule. The tagger's identity and version are part of the
 * ruleset fingerprint, because changing it changes scores.
 */

import nlp from 'compromise'
import type { Token } from './tokenize.ts'

/** Voxfold's tag set: a deliberately small, stable vocabulary rules can depend on. */
export type Tag =
  | 'NOUN'
  | 'PROPN'
  | 'VERB'
  | 'ADJ'
  | 'ADV'
  | 'PRON'
  | 'DET'
  | 'ADP'
  | 'CONJ'
  | 'NUM'
  | 'PUNCT'
  | 'OTHER'

export interface TaggedToken {
  token: Token
  tag: Tag
  /**
   * Whether this word can plausibly act: people, groups of people, and organizations. Used by
   * the "adverb on an inanimate subject" rule, which must not fire on "she" or "our team".
   */
  animate: boolean
  /** Base form when the tagger knows one ("syncs" → "sync"), else the normalized text. */
  lemma: string
}

export interface Tagger {
  readonly id: string
  tag(text: string, tokens: readonly Token[]): TaggedToken[]
}

/**
 * Nouns that denote people or groups of people, so an adverb on them reads naturally.
 * compromise already recognises pronouns and organizations; this covers the common
 * product-copy subjects it does not.
 */
const ANIMATE_NOUNS = new Set([
  'team',
  'teams',
  'founder',
  'founders',
  'engineer',
  'engineers',
  'developer',
  'developers',
  'designer',
  'designers',
  'user',
  'users',
  'customer',
  'customers',
  'client',
  'clients',
  'member',
  'members',
  'staff',
  'people',
  'person',
  'everyone',
  'someone',
  'anybody',
  'anyone',
  'nobody',
  'company',
  'companies',
  'startup',
  'startups',
  'business',
  'businesses',
  'partner',
  'partners',
  'writer',
  'writers',
  'reader',
  'readers',
  'author',
  'authors',
  'student',
  'students',
  'doctor',
  'doctors',
  'agent',
  'agents',
  'assistant',
  'assistants',
  'we',
  'i',
  'you',
  'they',
  'he',
  'she',
])

/** compromise tag → Voxfold tag, most specific first. */
const TAG_PRIORITY: ReadonlyArray<readonly [string, Tag]> = [
  ['Pronoun', 'PRON'],
  ['ProperNoun', 'PROPN'],
  ['Organization', 'PROPN'],
  ['Person', 'PROPN'],
  ['Place', 'PROPN'],
  ['Determiner', 'DET'],
  ['Preposition', 'ADP'],
  ['Conjunction', 'CONJ'],
  ['Adverb', 'ADV'],
  ['Adjective', 'ADJ'],
  ['Verb', 'VERB'],
  ['Value', 'NUM'],
  ['Cardinal', 'NUM'],
  ['Noun', 'NOUN'],
]

interface CompromiseTerm {
  text: string
  tags: string[]
  offset?: { start: number; length: number }
  normal?: string
}

function toTag(tags: readonly string[]): Tag {
  const set = new Set(tags)
  for (const [compromiseTag, tag] of TAG_PRIORITY) if (set.has(compromiseTag)) return tag
  return 'OTHER'
}

function isAnimate(tag: Tag, tags: readonly string[], lemma: string, raw: string): boolean {
  if (tag === 'PRON') return true
  const set = new Set(tags)
  if (set.has('Person') || set.has('Organization')) return true
  // A proper noun is usually a company or product name; treating it as animate keeps the
  // inanimate-adverb rule conservative ("Acme quietly ships" is not flagged).
  if (tag === 'PROPN') return true
  // A capitalized noun may be a brand or person the tagger does not know: at the start of a
  // sentence it cannot even tell capitalization from proper-noun-ness ("Acme" reads as a plain
  // noun there). Counting it as animate trades a missed tell for no false accusation, which is
  // the trade this whole tool is built on.
  if (tag === 'NOUN' && /^\p{Lu}/u.test(raw)) return true
  return ANIMATE_NOUNS.has(lemma)
}

/** Tag from a token's shape alone, used when the tagger has nothing to say about it. */
function fallbackTag(token: Token): Tag {
  if (token.type === 'number') return 'NUM'
  if (token.type === 'punctuation') return 'PUNCT'
  if (token.type === 'placeholder') return 'OTHER'
  return 'OTHER'
}

/**
 * The default tagger. compromise reports offsets into the text it was given, so results are
 * aligned back onto our own tokens by offset: our tokenizer stays the single source of truth
 * for positions, and the tagger only contributes labels.
 */
export class CompromiseTagger implements Tagger {
  readonly id: string

  constructor(version = COMPROMISE_VERSION) {
    this.id = `compromise@${version}`
  }

  tag(text: string, tokens: readonly Token[]): TaggedToken[] {
    const byStart = new Map<number, CompromiseTerm>()
    if (text.trim().length > 0) {
      const document = nlp(text)
      const json = document.json({
        offset: true,
        terms: { tags: true, offset: true, normal: true },
      })
      for (const sentence of json as Array<{ terms?: CompromiseTerm[] }>) {
        for (const term of sentence.terms ?? []) {
          // Zero-length terms are compromise's split of contractions ("It's" → "it" + "is").
          // Our tokenizer treats the contraction as one word, so only the anchored term counts.
          if (!term.offset || term.offset.length === 0) continue
          if (!byStart.has(term.offset.start)) byStart.set(term.offset.start, term)
        }
      }
    }

    return tokens.map((token) => {
      const term = byStart.get(token.start)
      // Only real words take a tagger label. compromise happily calls the placeholder character
      // a singular noun, and our tokenizer is the authority on what is a word.
      if (!term || token.type !== 'word') {
        return { token, tag: fallbackTag(token), animate: false, lemma: token.norm }
      }
      const tag = toTag(term.tags)
      const lemma = term.normal && term.normal.length > 0 ? term.normal : token.norm
      return { token, tag, animate: isAnimate(tag, term.tags, lemma, token.raw), lemma }
    })
  }
}

/**
 * Pinned for the fingerprint. compromise is an exact dependency: a tagger change moves scores,
 * so it must move the ruleset version too.
 */
export const COMPROMISE_VERSION = '14.17.0'

export const defaultTagger: Tagger = new CompromiseTagger()
