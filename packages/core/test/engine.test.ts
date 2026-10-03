import { describe, expect, it } from 'vitest'
import { BlockBuilder } from '../src/block-builder'
import { applyFixes, lint } from '../src/engine'
import type { Rule, RuleSet } from '../src/rules/schema'
import { combineScores, computeScore, DEFAULT_CALIBRATION, gradeFor } from '../src/score'
import type { BlockKind, Directive, ProseDocument } from '../src/types'

const rule = (overrides: Partial<Rule> & Pick<Rule, 'id' | 'match'>): Rule => ({
  lang: 'en',
  kind: 'structural',
  category: 'buzzword',
  weight: 1,
  severity: 'warn',
  message: overrides.id,
  docs: 'docs',
  examples: { flag: [], pass: [] },
  ...overrides,
})

const setOf = (...rules: Rule[]): RuleSet => ({ name: 'test', version: '1.0.0', rules })

function docOf(
  text: string,
  options: { kind?: BlockKind; directives?: Directive[]; weight?: number } = {},
): ProseDocument {
  const { block } = new BlockBuilder().addText(text, 0, text.length).build({
    id: 'b1',
    kind: options.kind ?? 'paragraph',
    context: { weight: options.weight ?? 1 },
  })
  return {
    uri: 'test.md',
    format: 'markdown',
    source: text,
    blocks: [block],
    directives: options.directives ?? [],
  }
}

describe('engine: matching and flags', () => {
  const utilize = rule({
    id: 'utilize',
    kind: 'mechanical',
    match: { type: 'words', words: ['utilize'] },
    fix: { type: 'replace', map: { utilize: 'use' } },
  })

  it('reports flags with source ranges that slice back to the matched text', () => {
    const document = docOf('We utilize it and they utilize it.')
    const result = lint(document, setOf(utilize))

    expect(result.flags).toHaveLength(2)
    for (const flag of result.flags) {
      const range = flag.sourceRanges[0]!
      expect(document.source!.slice(range.start, range.end)).toBe(flag.text)
      expect(flag.editable).toBe(true)
    }
  })

  it('orders flags by position, not by rule evaluation order', () => {
    const zebra = rule({ id: 'zebra', match: { type: 'words', words: ['zebra'] } })
    const alpha = rule({ id: 'alpha', match: { type: 'words', words: ['alpha'] } })
    const result = lint(docOf('zebra then alpha'), setOf(alpha, zebra))
    expect(result.flags.map((flag) => flag.ruleId)).toEqual(['zebra', 'alpha'])
  })

  it('marks text spanning a placeholder as not editable', () => {
    const { block } = new BlockBuilder()
      .addText('utilize ', 0, 8)
      .addPlaceholder(8, 20, { lockReason: 'variable' })
      .build({ id: 'b1', kind: 'paragraph' })
    const document: ProseDocument = {
      uri: 'x.tsx',
      format: 'jsx',
      source: 'utilize {value}',
      blocks: [block],
      directives: [],
    }
    const wide = rule({ id: 'wide', match: { type: 'regex', pattern: 'utilize .' } })
    expect(lint(document, setOf(wide)).flags[0]?.editable).toBe(false)
  })
})

describe('engine: density', () => {
  const emDash = rule({
    id: 'em-dash',
    weight: 3,
    match: { type: 'chars', chars: ['—'] },
    density: { per: 'block', threshold: 3, below: 0.2 },
  })

  it('flags every occurrence but charges little below the threshold', () => {
    const sparse = lint(docOf('One — dash only.'), setOf(emDash))
    expect(sparse.flags).toHaveLength(1)
    expect(sparse.flags[0]!.dense).toBe(false)
    expect(sparse.flags[0]!.contribution).toBeCloseTo(0.6)
  })

  it('charges full weight once the window reaches the threshold', () => {
    const dense = lint(docOf('a — b — c — d'), setOf(emDash))
    expect(dense.flags).toHaveLength(3)
    expect(dense.flags.every((flag) => flag.dense)).toBe(true)
    expect(dense.stats.contribution).toBeCloseTo(9)
    expect(dense.flags[0]!.message).toContain('3 in this block')
  })

  it('applies per-block-kind overrides, so short headings are judged more gently', () => {
    const withOverride = rule({
      ...emDash,
      densityOverrides: { heading: { threshold: 5 } },
    })
    const heading = lint(docOf('a — b — c — d', { kind: 'heading' }), setOf(withOverride))
    expect(heading.flags.every((flag) => flag.dense)).toBe(false)
  })

  it('weights footer and legal blocks at half', () => {
    const footer = lint(docOf('One — dash.', { weight: 0.5 }), setOf(emDash))
    expect(footer.flags[0]!.contribution).toBeCloseTo(0.3)
  })
})

describe('engine: fixes and suggestions', () => {
  it('applies a replacement fix and preserves the original casing', () => {
    const utilize = rule({
      id: 'utilize',
      kind: 'mechanical',
      match: { type: 'words', words: ['utilize', 'Utilize'] },
      fix: { type: 'replace', map: { utilize: 'use' } },
    })
    const text = 'Utilize it, then utilize it again.'
    const result = lint(docOf(text), setOf(utilize))
    expect(applyFixes(text, result.flags)).toBe('Use it, then use it again.')
  })

  it('deletes a word and closes the gap', () => {
    const seamlessly = rule({
      id: 'seamlessly',
      kind: 'mechanical',
      match: { type: 'words', words: ['seamlessly'] },
      fix: { type: 'delete', cleanup: ['collapse-space'] },
    })
    const text = 'It integrates seamlessly with your stack.'
    const result = lint(docOf(text), setOf(seamlessly))
    expect(applyFixes(text, result.flags)).toBe('It integrates with your stack.')
  })

  it('deletes an opener, drops its comma and recapitalizes', () => {
    const opener = rule({
      id: 'opener',
      kind: 'mechanical',
      match: { type: 'phrases', phrases: ["in today's fast-paced world"] },
      fix: { type: 'delete', cleanup: ['collapse-space', 'dangling-comma', 'recapitalize'] },
    })
    const text = "In today's fast-paced world, teams need better tools."
    const result = lint(docOf(text), setOf(opener))
    expect(applyFixes(text, result.flags)).toBe('Teams need better tools.')
  })

  it('downgrades a fix to a suggestion when the result would not be well formed', () => {
    // Deleting the only content leaves nothing behind, so it must not be applied unattended.
    const deleteAll = rule({
      id: 'delete-all',
      kind: 'mechanical',
      match: { type: 'phrases', phrases: ['gone'] },
      fix: { type: 'delete', cleanup: ['collapse-space'] },
    })
    const result = lint(docOf('gone'), setOf(deleteAll))
    expect(result.flags[0]!.fix).toBeUndefined()
    expect(result.flags[0]!.suggestions?.[0]?.label).toBe('delete')
  })

  it('offers punctuation choices as suggestions and never as a fix', () => {
    const emDash = rule({
      id: 'em-dash',
      kind: 'mechanical',
      match: { type: 'chars', chars: ['—'] },
      suggest: [
        { label: 'comma', replace: ', ' },
        { label: 'full stop', replace: '. ', recapitalize: true },
      ],
    })
    const result = lint(docOf('It ships fast—really fast.'), setOf(emDash))
    const flag = result.flags[0]!
    expect(flag.fix).toBeUndefined()
    expect(flag.suggestions?.map((s) => s.label)).toEqual(['comma', 'full stop'])
  })

  it('swallows the spaces around a punctuation replacement instead of doubling them', () => {
    const emDash = rule({
      id: 'em-dash',
      kind: 'mechanical',
      match: { type: 'chars', chars: ['—'] },
      fix: { type: 'replace', map: { '*': ', ' } },
    })
    const text = 'It fits your stack — quietly. Or fits—it works.'
    const result = lint(docOf(text), setOf(emDash))
    expect(applyFixes(text, result.flags)).toBe('It fits your stack, quietly. Or fits, it works.')
  })

  it('refuses to delete a word when it would leave "a" before a vowel', () => {
    const seamless = rule({
      id: 'seamless',
      kind: 'mechanical',
      match: { type: 'words', words: ['seamless'] },
      fix: { type: 'delete', cleanup: ['collapse-space'] },
    })
    const text = 'A seamless experience.'
    const result = lint(docOf(text), setOf(seamless))
    expect(result.flags[0]!.fix).toBeUndefined()
    expect(applyFixes(text, result.flags)).toBe(text)
  })

  it('still deletes a word when the article agrees with what follows', () => {
    const seamless = rule({
      id: 'seamless',
      kind: 'mechanical',
      match: { type: 'words', words: ['seamless'] },
      fix: { type: 'delete', cleanup: ['collapse-space'] },
    })
    const text = 'A seamless product, and an apple.'
    const result = lint(docOf(text), setOf(seamless))
    expect(applyFixes(text, result.flags)).toBe('A product, and an apple.')
  })

  it('does not combine fixes that sit right next to each other', () => {
    const effortlessly = rule({
      id: 'effortlessly',
      kind: 'mechanical',
      match: { type: 'words', words: ['effortlessly'] },
      fix: { type: 'delete', cleanup: ['collapse-space'] },
    })
    const emDash = rule({
      id: 'em-dash',
      kind: 'mechanical',
      match: { type: 'chars', chars: ['—'] },
      fix: { type: 'replace', map: { '*': ', ' } },
    })
    const text = 'It works quietly, effortlessly — so use it.'
    const result = lint(docOf(text), setOf(effortlessly, emDash))
    const once = applyFixes(text, result.flags)
    expect(once).not.toMatch(/,\s*,|\s,/)
    const second = lint(docOf(once), setOf(effortlessly, emDash))
    expect(applyFixes(once, second.flags)).not.toMatch(/,\s*,|\s,|—/)
  })

  it('skips overlapping fixes rather than guessing which rule wins', () => {
    const a = rule({
      id: 'a',
      kind: 'mechanical',
      match: { type: 'phrases', phrases: ['very fast'] },
      fix: { type: 'replace', map: { 'very fast': 'quick' } },
    })
    const b = rule({
      id: 'b',
      kind: 'mechanical',
      match: { type: 'words', words: ['very'] },
      fix: { type: 'replace', map: { very: 'extremely' } },
    })
    const text = 'It is very fast.'
    const result = lint(docOf(text), setOf(a, b))
    expect(applyFixes(text, result.flags)).toBe('It is quick.')
  })
})

describe('engine: fix offsets are SOURCE offsets, not flat-block offsets', () => {
  // Regression coverage for a real corruption bug: Flag.fix/.suggestions edits were computed in
  // flat-block-text coordinates but applied directly to the document source. Every test above
  // this point builds its document with a single block starting at source offset 0 — where flat
  // offset and source offset are numerically identical by pure coincidence — so none of them
  // could have caught it. These tests deliberately break that coincidence.

  it('applies a fix correctly when the block does not start at source offset 0', () => {
    const utilize = rule({
      id: 'utilize',
      kind: 'mechanical',
      match: { type: 'words', words: ['utilize'] },
      fix: { type: 'replace', map: { utilize: 'use' } },
    })
    // Front matter-like preamble pushes the block's source start well past 0, while the flag's
    // match offset within the block's flat text starts near 0.
    const preamble = '---\ntitle: Something\n---\n\n'
    const sentence = 'We utilize modern tooling here.'
    const text = preamble + sentence

    const { block } = new BlockBuilder()
      .addText(sentence, preamble.length, text.length)
      .build({ id: 'b1', kind: 'paragraph' })
    const document: ProseDocument = {
      uri: 'test.md',
      format: 'markdown',
      source: text,
      blocks: [block],
      directives: [],
    }

    const result = lint(document, setOf(utilize))
    const flag = result.flags[0]!
    // The flat-text match is near offset 0, but the source fix must land at the real position.
    expect(flag.fix![0]!.start).toBe(preamble.length + 'We '.length)
    expect(applyFixes(text, result.flags)).toBe(`${preamble}We use modern tooling here.`)
  })

  it('applies fixes correctly across multiple blocks at different source offsets', () => {
    const utilize = rule({
      id: 'utilize',
      kind: 'mechanical',
      match: { type: 'words', words: ['utilize'] },
      fix: { type: 'replace', map: { utilize: 'use' } },
    })
    const text = 'First we utilize caching.\n\nThen we utilize batching.'
    const firstSentence = 'First we utilize caching.'
    const secondSentence = 'Then we utilize batching.'
    const secondStart = text.indexOf(secondSentence)

    const first = new BlockBuilder()
      .addText(firstSentence, 0, firstSentence.length)
      .build({ id: 'b1', kind: 'paragraph' }).block
    const second = new BlockBuilder()
      .addText(secondSentence, secondStart, secondStart + secondSentence.length)
      .build({ id: 'b2', kind: 'paragraph' }).block

    const document: ProseDocument = {
      uri: 'test.md',
      format: 'markdown',
      source: text,
      blocks: [first, second],
      directives: [],
    }

    const result = lint(document, setOf(utilize))
    expect(result.flags).toHaveLength(2)
    expect(applyFixes(text, result.flags)).toBe('First we use caching.\n\nThen we use batching.')
  })

  it('refuses a fix that would span a locked or non-contiguous segment, rather than mis-locating it', () => {
    // "utilize {x}" where the word after utilize is a placeholder: a rule matching "utilize ."
    // via regex would span the placeholder. That must never translate to a source edit.
    const wideMatch = rule({
      id: 'wide',
      kind: 'mechanical',
      match: { type: 'regex', pattern: 'utilize .' },
      fix: { type: 'replace', map: { '*': 'use it' } },
    })
    const { block } = new BlockBuilder()
      .addText('utilize ', 0, 8)
      .addPlaceholder(8, 20, { lockReason: 'variable' })
      .build({ id: 'b1', kind: 'paragraph' })
    const document: ProseDocument = {
      uri: 'x.tsx',
      format: 'jsx',
      source: 'utilize {value}',
      blocks: [block],
      directives: [],
    }
    const result = lint(document, setOf(wideMatch))
    expect(result.flags[0]!.fix).toBeUndefined()
  })

  it('produces a byte-identical result to hand-applying the same edit to the real source', () => {
    // The exact shape of the bug that was found: a markdown file with running prose before the
    // flagged sentence, linted through the real BlockBuilder/OffsetMap, fixed, and diffed against
    // manual find-and-replace on the ORIGINAL file text.
    const utilize = rule({
      id: 'utilize',
      kind: 'mechanical',
      match: { type: 'words', words: ['utilize'] },
      fix: { type: 'replace', map: { utilize: 'use' } },
    })
    const text =
      '# Title\n\nSome unrelated leading prose that has nothing to do with the flag below.\n\n' +
      'This paragraph does utilize a word that should be fixed.\n'
    const target = 'This paragraph does utilize a word that should be fixed.'
    const start = text.indexOf(target)

    const { block } = new BlockBuilder()
      .addText(target, start, start + target.length)
      .build({ id: 'b1', kind: 'paragraph' })
    const document: ProseDocument = {
      uri: 'test.md',
      format: 'markdown',
      source: text,
      blocks: [block],
      directives: [],
    }

    const result = lint(document, setOf(utilize))
    const expected = text.replace('utilize', 'use')
    expect(applyFixes(text, result.flags)).toBe(expected)
  })
})

describe('engine: directives and suppressions', () => {
  const buzz = rule({ id: 'buzz', match: { type: 'words', words: ['buzzword'] } })

  it('silences a rule for the next line', () => {
    const text = '<!-- c -->\nA buzzword here.'
    const directives: Directive[] = [
      { type: 'disable-next-line', rules: ['buzz'], src: { start: 0, end: 10 }, line: 1 },
    ]
    const { block } = new BlockBuilder()
      .addText('A buzzword here.', 11, text.length)
      .build({ id: 'b1', kind: 'paragraph' })
    const document: ProseDocument = {
      uri: 'test.md',
      format: 'markdown',
      source: text,
      blocks: [block],
      directives,
    }
    expect(lint(document, setOf(buzz)).flags).toHaveLength(0)
    expect(lint(document, setOf(buzz), { includeSuppressed: true }).flags[0]?.suppressed).toBe(
      'inline',
    )
  })

  it('silences a rule by hash from the suppressions file, and stops it scoring', () => {
    const document = docOf('A buzzword here.')
    const flag = lint(document, setOf(buzz)).flags[0]!
    const suppressed = lint(document, setOf(buzz), {
      suppressions: { version: 1, files: { 'test.md': [{ rule: 'buzz', hash: flag.hash }] } },
    })
    expect(suppressed.flags).toHaveLength(0)
    expect(suppressed.stats.contribution).toBe(0)
  })

  it('keeps a suppression hash stable when the text moves lines', () => {
    const first = lint(docOf('A buzzword here.'), setOf(buzz)).flags[0]!
    const moved = lint(docOf('Intro line.\n\nA buzzword here.'), setOf(buzz)).flags[0]!
    expect(moved.hash).toBe(first.hash)
  })
})

describe('engine: config overrides', () => {
  const buzz = rule({ id: 'buzz', weight: 4, match: { type: 'words', words: ['buzzword'] } })

  it('turns a rule off and reweights another', () => {
    const document = docOf('A buzzword here.')
    expect(lint(document, setOf(buzz), { overrides: { buzz: { severity: 'off' } } }).flags).toEqual(
      [],
    )
    const reweighted = lint(document, setOf(buzz), { overrides: { buzz: { weight: 1 } } })
    expect(reweighted.stats.contribution).toBe(1)
  })

  it('raises severity to error for CI gates', () => {
    const result = lint(docOf('A buzzword here.'), setOf(buzz), {
      overrides: { buzz: { severity: 'error' } },
    })
    expect(result.flags[0]!.severity).toBe('error')
  })
})

describe('scoring', () => {
  it('refuses to score text below the minimum word count', () => {
    expect(computeScore({ contribution: 3, words: 10, ruleset: 'r' })).toBeNull()
  })

  it('scores clean text at 100 and dirty text lower', () => {
    const clean = computeScore({ contribution: 0, words: 200, ruleset: 'r' })!
    expect(clean.value).toBe(100)
    expect(clean.grade).toBe('A')

    const dirty = computeScore({ contribution: 20, words: 200, ruleset: 'r' })!
    expect(dirty.value).toBeLessThan(clean.value)
    expect(dirty.tellsPer100).toBeCloseTo(10)
  })

  it('is monotonic: more tells never scores higher', () => {
    let previous = 101
    for (let contribution = 0; contribution <= 60; contribution += 3) {
      const score = computeScore({ contribution, words: 300, ruleset: 'r' })!
      expect(score.value).toBeLessThanOrEqual(previous)
      previous = score.value
    }
  })

  it('maps grades at the documented cut-offs', () => {
    expect(gradeFor(DEFAULT_CALIBRATION.cutoffs.A)).toBe('A')
    expect(gradeFor(DEFAULT_CALIBRATION.cutoffs.B)).toBe('B')
    expect(gradeFor(DEFAULT_CALIBRATION.cutoffs.D - 1)).toBe('F')
  })

  it('weights a multi-file score by words, so one short page cannot swing it', () => {
    const combined = combineScores(
      [
        { contribution: 0, words: 2000 },
        { contribution: 4, words: 20 },
      ],
      'r',
    )!
    expect(combined.value).toBeGreaterThan(90)
  })

  it('reports the ruleset and tagger identity with the score', () => {
    const result = lint(docOf('Nothing to see here.'.repeat(20)), setOf())
    expect(result.ruleset).toMatch(/^test@1\.0\.0\+compromise@/)
  })
})

describe('engine: determinism', () => {
  it('produces identical results across runs', () => {
    const buzz = rule({ id: 'buzz', match: { type: 'words', words: ['buzzword'] } })
    const document = docOf('A buzzword and another buzzword.')
    const first = JSON.stringify(lint(document, setOf(buzz)))
    const second = JSON.stringify(lint(document, setOf(buzz)))
    expect(first).toBe(second)
  })
})
