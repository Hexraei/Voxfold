import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BlockBuilder } from '../src/block-builder.ts'
import { lint } from '../src/engine.ts'
import type { RuleSet } from '../src/rules/schema.ts'
import rules from './structure-rules.json' with { type: 'json' }

const ruleset: RuleSet = { name: 'structure', version: '0.0.0', rules: rules as never }

function doc(texts: string[], emphasis: Array<Array<[number, number]>> = []) {
  const blocks = texts.map((text, i) => {
    const built = new BlockBuilder()
      .addText(text, 0, text.length)
      .build({ id: `b${i}`, kind: 'paragraph' }).block
    if (emphasis[i]) built.emphasis = emphasis[i]
    return built
  })
  return { uri: 't.md', format: 'markdown' as const, blocks, directives: [] }
}
const ids = (r: ReturnType<typeof lint>) => r.flags.map((f) => f.ruleId)

describe('scope-disclaimer', () => {
  it('flags claim-negation sentences', () => {
    const r = lint(
      doc([
        'No speed advantage over the reference solver is claimed.',
        'This is not a production guarantee.',
        'It does not replace the full benchmark.',
      ]),
      ruleset,
    )
    expect(ids(r).filter((x) => x === 'scope-disclaimer')).toHaveLength(3)
  })
  it('stays quiet on plain statements and on ordinary negation', () => {
    const r = lint(
      doc([
        'The solver passed 90 of 93 cases.',
        'This API should not be used in new projects.',
        'Do not run it as root.',
      ]),
      ruleset,
    )
    expect(ids(r)).toEqual([])
  })
  it('costs little when the document has only a couple', () => {
    const text = 'This is not a production guarantee. '.repeat(1) + 'Words '.repeat(120)
    const r = lint(doc([text]), ruleset)
    expect(r.flags[0]?.dense).toBe(false)
  })
})

describe('not-x-contrast', () => {
  it('flags "X, not Y" and "is not X; it is Y"', () => {
    const r = lint(
      doc(['It is a smoke test, not a benchmark.', 'This is not a benchmark; it is a smoke test.']),
      ruleset,
    )
    expect(ids(r).filter((x) => x === 'not-x-contrast')).toHaveLength(2)
  })
  it('ignores "not to" and "not compatible"', () => {
    const r = lint(
      doc(['Use a flag, not to disable it.', 'This build is not compatible with Node 12.']),
      ruleset,
    )
    expect(ids(r)).toEqual([])
  })
})

describe('bold-overuse', () => {
  const text = 'One and two and three are all bold here.'
  it('flags blocks with three or more bold spans', () => {
    const r = lint(
      doc(
        [text],
        [
          [
            [0, 3],
            [8, 11],
            [16, 21],
          ],
        ],
      ),
      ruleset,
    )
    expect(ids(r).filter((x) => x === 'bold-overuse')).toHaveLength(3)
  })
  it('allows one or two', () => {
    expect(
      ids(
        lint(
          doc(
            [text],
            [
              [
                [0, 3],
                [8, 11],
              ],
            ],
          ),
          ruleset,
        ),
      ),
    ).toEqual([])
  })
  it('does nothing when the adapter gives no emphasis', () => {
    expect(ids(lint(doc([text]), ruleset))).toEqual([])
  })
})

describe('dense-paragraph', () => {
  it('flags a 130-word paragraph once, on its first sentence', () => {
    const r = lint(doc([`Start here. ${'word '.repeat(130)}end.`]), ruleset)
    expect(r.flags.filter((f) => f.ruleId === 'dense-paragraph')).toHaveLength(1)
  })
  it('allows a 60-word paragraph', () => {
    expect(ids(lint(doc(['word '.repeat(60) + 'end.']), ruleset))).toEqual([])
  })
})

describe('true-negative controls', () => {
  it.each(['csv-stringify.md', 'zod.md', 'turndown.md'])(
    '%s trips none of the structure rules',
    (file) => {
      const text = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')
      const paras = text
        .split('\n')
        .filter((p) => p.trim() && !/^(```|<|\||\s*\*\*)/.test(p.trim()))
      expect(ids(lint(doc(paras), ruleset))).toEqual([])
    },
  )
})

describe('bold-lead-in-list needs real bold', () => {
  const rule = {
    id: 'bold-lead-in-list',
    lang: 'en',
    kind: 'structural',
    category: 'markdown',
    weight: 2,
    severity: 'warn',
    message: 'bold lead-in',
    docs: 'd',
    match: { type: 'detector', detector: 'bold-lead-in-list' },
    examples: { flag: [], pass: [] },
  }
  const set: RuleSet = { name: 't', version: '0', rules: [rule as never] }
  const item = (text: string, emphasis?: Array<[number, number]>) => {
    const block = new BlockBuilder()
      .addText(text, 0, text.length)
      .build({ id: 'i', kind: 'listItem' }).block
    if (emphasis) block.emphasis = emphasis
    return { uri: 't.md', format: 'markdown' as const, blocks: [block], directives: [] }
  }
  it('flags a bolded lead-in', () => {
    expect(lint(item('Fast: ships in milliseconds', [[0, 4]]), set).flags).toHaveLength(1)
  })
  it('ignores a plain colon lead when emphasis is reported', () => {
    expect(lint(item('WOOD1P: iteration limit', []), set).flags).toHaveLength(0)
    expect(lint(item('MODSZK1: lost primal feasibility', [[20, 30]]), set).flags).toHaveLength(0)
  })
  it('keeps the old shape-only match when the adapter reports no emphasis', () => {
    expect(lint(item('Fast: ships in milliseconds'), set).flags).toHaveLength(1)
  })
})
