import { describe, expect, it } from 'vitest'
import { defaultTagger } from '../src/text/tagger'
import { tokenize } from '../src/text/tokenize'
import { PLACEHOLDER_CHAR } from '../src/types'

const tag = (text: string) => defaultTagger.tag(text, tokenize(text))
const wordTags = (text: string) =>
  tag(text)
    .filter((t) => t.token.type === 'word')
    .map((t) => `${t.token.raw}:${t.tag}`)

describe('CompromiseTagger', () => {
  it('separates a thing-subject from a person-subject', () => {
    const inanimate = tag('The dashboard quietly syncs your data.')
    const dashboard = inanimate.find((t) => t.token.raw === 'dashboard')
    expect(dashboard?.tag).toBe('NOUN')
    expect(dashboard?.animate).toBe(false)

    const animate = tag('She quietly left the room.')
    const she = animate.find((t) => t.token.raw === 'She')
    expect(she?.tag).toBe('PRON')
    expect(she?.animate).toBe(true)
  })

  it('treats teams, users and company names as animate', () => {
    for (const [text, word] of [
      ['Our team gently reminds you.', 'team'],
      ['Users quietly abandon slow pages.', 'Users'],
      ['Acme quietly ships code.', 'Acme'],
    ] as const) {
      const found = tag(text).find((t) => t.token.raw === word)
      expect(`${word}:${found?.animate}`).toBe(`${word}:true`)
    }
  })

  it('counts an unknown capitalized noun as animate (a known, deliberate miss)', () => {
    // At the start of a sentence the tagger cannot tell a brand name from a common noun, so
    // "Dashboard quietly syncs" is not flagged. A missed tell beats a false accusation; the
    // lower-case form, which is the common case in body copy, still flags.
    expect(
      tag('Dashboard quietly syncs data.').find((t) => t.token.raw === 'Dashboard')?.animate,
    ).toBe(true)
    expect(
      tag('The dashboard quietly syncs data.').find((t) => t.token.raw === 'dashboard')?.animate,
    ).toBe(false)
  })

  it('labels the parts of speech the rules depend on', () => {
    expect(wordTags('We leverage robust tooling')).toEqual([
      'We:PRON',
      'leverage:VERB',
      'robust:ADJ',
      'tooling:NOUN',
    ])
    expect(wordTags('seamlessly integrates')).toEqual(['seamlessly:ADV', 'integrates:VERB'])
  })

  it('aligns tags onto our own token offsets, including contractions', () => {
    const text = "It's not just a tool, it's a workflow."
    for (const tagged of tag(text)) {
      expect(text.slice(tagged.token.start, tagged.token.end)).toBe(tagged.token.raw)
    }
    const contraction = tag(text).find((t) => t.token.raw === "It's")
    expect(contraction?.tag).toBe('PRON')
  })

  it('gives every token a tag, placeholders included', () => {
    const text = `Run ${PLACEHOLDER_CHAR} now.`
    const tagged = tag(text)
    expect(tagged).toHaveLength(tokenize(text).length)
    expect(tagged.find((t) => t.token.type === 'placeholder')?.tag).toBe('OTHER')
  })

  it('is deterministic and handles empty input', () => {
    expect(tag('')).toEqual([])
    expect(JSON.stringify(wordTags('The platform quietly scales'))).toBe(
      JSON.stringify(wordTags('The platform quietly scales')),
    )
  })

  it('reports an id that identifies the tagger and version', () => {
    expect(defaultTagger.id).toMatch(/^compromise@\d+\.\d+\.\d+$/)
  })
})
