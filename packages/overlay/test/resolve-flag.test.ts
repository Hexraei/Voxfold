import { type Flag, lint } from '@voxfold/core'
import { recommended } from '@voxfold/rules-recommended'
import { describe, expect, it } from 'vitest'
import { flattenDocument } from '../src/dom-flatten.ts'
import { resolveFlagToDom } from '../src/resolve-flag.ts'

function setBody(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

describe('resolveFlagToDom', () => {
  it('resolves a flag within a single text node to a Range covering the exact matched text', () => {
    const body = setBody(
      `<p>We utilize a robust platform every single day for our whole growing team here.</p>`,
    )
    const { blocks, refs } = flattenDocument(body)
    const result = lint({ uri: 'live', format: 'html', blocks, directives: [] }, recommended)
    const flag = result.flags.find((f) => f.ruleId === 'utilize')!

    const resolved = resolveFlagToDom(flag, blocks, refs)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]!.range.toString()).toBe('utilize')
    expect(resolved[0]!.editable).toBe(true)
  })

  it('resolves a flag spanning an inline tag into one Range per segment', () => {
    const body = setBody(
      `<p>Our platform <strong>doesn't just</strong> manage tasks, it's a workflow today.</p>`,
    )
    const { blocks, refs } = flattenDocument(body)
    const result = lint({ uri: 'live', format: 'html', blocks, directives: [] }, recommended)
    const flag = result.flags.find((f) => f.ruleId === 'not-just-x-its-y')!
    expect(flag).toBeDefined()

    const resolved = resolveFlagToDom(flag, blocks, refs)
    expect(resolved.length).toBeGreaterThanOrEqual(1)
    const rebuilt = resolved.map((r) => r.range.toString()).join('')
    expect(rebuilt).toBe(flag.text)
  })

  it('returns an empty array for a flag whose blockId is not in the given blocks', () => {
    const body = setBody(`<p>We utilize a robust platform every day for our whole team here.</p>`)
    const { blocks, refs } = flattenDocument(body)
    const result = lint({ uri: 'live', format: 'html', blocks, directives: [] }, recommended)
    const flag = result.flags[0]!

    const resolved = resolveFlagToDom({ ...flag, blockId: 'nonexistent' }, blocks, refs)
    expect(resolved).toEqual([])
  })

  it('marks a placeholder-backed flag as not editable and yields no DOM range for it', () => {
    const body = setBody(
      `<p>Run <code>npm install</code> to begin the whole process now for everyone.</p>`,
    )
    const { blocks, refs } = flattenDocument(body)
    // The placeholder segment itself has no `node` (dom-text) ref, so resolveFlagToDom
    // legitimately produces nothing for a flatRange sitting entirely on it; this test documents
    // that expectation rather than asserting a specific rule fires there.
    const block = blocks[0]!
    const placeholderSegment = block.segments.find((s) => s.kind === 'placeholder')!
    const flag: Flag = {
      ruleId: 'fake',
      kind: 'structural',
      category: 'construction',
      severity: 'warn',
      message: '',
      docs: '',
      blockId: block.id,
      flatRange: [placeholderSegment.flatStart, placeholderSegment.flatEnd],
      sourceRanges: [],
      text: '',
      contribution: 0,
      dense: false,
      editable: false,
      hash: 'x',
    }
    const resolved = resolveFlagToDom(flag, blocks, refs)
    expect(resolved).toEqual([])
  })
})
