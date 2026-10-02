/**
 * Every rule's examples are fixtures.
 *
 * `flag` examples must produce that rule's flag; `pass` examples must not. This is where rule
 * quality is actually enforced: a rule with vague wording tends to fail its own pass cases.
 */

import { type Block, BlockBuilder, type BlockKind, lint, type ProseDocument } from '@voxfold/core'
import { describe, expect, it } from 'vitest'
import { recommended } from '../src/index'

/** Build a single-block document from plain text, as if an adapter had extracted it. */
function documentOf(
  example: string,
  kind: BlockKind,
  format: ProseDocument['format'],
): ProseDocument {
  // `**bold**` in an example becomes real emphasis: the markers are removed from the text and
  // their ranges reported the way the Markdown adapter reports them.
  const emphasis: Array<[number, number]> = []
  let text = ''
  let open = -1
  for (let i = 0; i < example.length; i++) {
    if (example.startsWith('**', i)) {
      if (open < 0) open = text.length
      else {
        emphasis.push([open, text.length])
        open = -1
      }
      i++
    } else text += example[i]
  }
  const { block } = new BlockBuilder().addText(text, 0, text.length).build({ id: 'b1', kind })
  block.emphasis = emphasis
  return {
    uri: `example.${format}`,
    format,
    source: text,
    blocks: [block as Block],
    directives: [],
  }
}

/** Kind and format an example should be linted as, taken from the rule's own restrictions. */
function contextFor(rule: (typeof recommended.rules)[number]): {
  kind: BlockKind
  format: ProseDocument['format']
} {
  const format = rule.formats?.[0] ?? 'markdown'
  const kind = rule.appliesTo?.[0] ?? 'paragraph'
  return { kind, format }
}

const ruleIds = new Set(recommended.rules.map((rule) => rule.id))

describe('recommended rule set', () => {
  it('ships a versioned, non-empty set with unique ids', () => {
    expect(recommended.name).toBe('recommended')
    expect(recommended.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(recommended.rules.length).toBeGreaterThanOrEqual(40)
    expect(ruleIds.size).toBe(recommended.rules.length)
  })

  it('never attaches an automatic fix to a structural rule', () => {
    // The product promise: mechanical tells get fixed, structural ones get named and left to a
    // human. A fix on a structural rule would quietly break that.
    for (const rule of recommended.rules) {
      if (rule.kind === 'structural') expect(rule.fix, `${rule.id} has a fix`).toBeUndefined()
    }
  })

  for (const rule of recommended.rules) {
    describe(rule.id, () => {
      const { kind, format } = contextFor(rule)

      for (const example of rule.examples.flag) {
        it(`flags: ${example}`, () => {
          const result = lint(documentOf(example, kind, format), recommended)
          const hit = result.flags.filter((flag) => flag.ruleId === rule.id)
          expect(
            hit.length,
            `expected ${rule.id} to flag, got: ${result.flags.map((f) => f.ruleId).join(', ') || 'nothing'}`,
          ).toBeGreaterThan(0)
          // A flag must point at real text, not an empty range.
          expect(hit[0]!.flatRange[1]).toBeGreaterThan(hit[0]!.flatRange[0])
        })
      }

      for (const example of rule.examples.pass) {
        it(`passes: ${example}`, () => {
          const result = lint(documentOf(example, kind, format), recommended)
          const hit = result.flags.filter((flag) => flag.ruleId === rule.id)
          expect(
            hit.map((f) => f.text),
            `${rule.id} should not fire here`,
          ).toEqual([])
        })
      }
    })
  }
})
