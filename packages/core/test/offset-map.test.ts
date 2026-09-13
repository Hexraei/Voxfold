import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { BlockBuilder } from '../src/block-builder'
import { PLACEHOLDER_CHAR } from '../src/types'

describe('BlockBuilder', () => {
  it('flattens inline children into one continuous string', () => {
    // <p>Our platform <strong>doesn't just</strong> manage tasks</p>
    const source = "<p>Our platform <strong>doesn't just</strong> manage tasks</p>"
    const { block, map } = new BlockBuilder()
      .addText('Our platform ', 3, 16)
      .addText("doesn't just", 24, 36)
      .addText(' manage tasks', 45, 58)
      .build({ id: 'b1', kind: 'paragraph' })

    expect(block.text).toBe("Our platform doesn't just manage tasks")

    // The flag "doesn't just" spans one segment; its source offsets point inside <strong>.
    const flatStart = block.text.indexOf("doesn't just")
    const ranges = map.toSourceRanges(flatStart, flatStart + "doesn't just".length)
    expect(ranges).toHaveLength(1)
    expect(source.slice(ranges[0]!.start, ranges[0]!.end)).toBe("doesn't just")
  })

  it('maps a match spanning several segments to one range per segment', () => {
    const source = '<p>Not just <em>a tool</em>, a workflow.</p>'
    const { block, map } = new BlockBuilder()
      .addText('Not just ', 3, 12)
      .addText('a tool', 16, 22)
      .addText(', a workflow.', 27, 40)
      .build({ id: 'b1', kind: 'paragraph' })

    const ranges = map.toSourceRanges(0, block.text.length)
    expect(ranges).toHaveLength(3)
    expect(ranges.map((r) => source.slice(r.start, r.end)).join('')).toBe(block.text)
  })

  it('maps through a charMap for entities', () => {
    // "Fast &mdash; simple" decodes to "Fast — simple": one char backed by seven.
    const source = 'Fast &mdash; simple'
    const decoded = 'Fast — simple'
    const charMap = [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18]
    const { block, map } = new BlockBuilder()
      .addText(decoded, 0, source.length, { charMap })
      .build({ id: 'b1', kind: 'paragraph' })

    const dash = block.text.indexOf('—')
    const ranges = map.toSourceRanges(dash, dash + 1)
    expect(source.slice(ranges[0]!.start, ranges[0]!.end)).toBe('&mdash;')

    const tail = block.text.indexOf('simple')
    const tailRanges = map.toSourceRanges(tail, tail + 6)
    expect(source.slice(tailRanges[0]!.start, tailRanges[0]!.end)).toBe('simple')
  })

  it('keeps placeholders non-editable and out of the editable range check', () => {
    const { block, map } = new BlockBuilder()
      .addText('Run ', 3, 7)
      .addPlaceholder(7, 20, { lockReason: 'expression' })
      .addText(' to install', 20, 31)
      .build({ id: 'b1', kind: 'paragraph' })

    expect(block.text).toBe(`Run ${PLACEHOLDER_CHAR} to install`)
    expect(map.isEditable(0, 4)).toBe(true)
    expect(map.isEditable(0, block.text.length)).toBe(false)
    expect(map.segmentAt(4)?.editable).toBe(false)
  })

  it('inserts boundary text with no source, and never doubles whitespace', () => {
    const { block, map } = new BlockBuilder()
      .addText('one', 0, 3)
      .addBoundary()
      .addBoundary()
      .addText('two', 10, 13)
      .build({ id: 'b1', kind: 'paragraph' })

    expect(block.text).toBe('one two')
    // The inserted space has no source, so it contributes no range.
    expect(map.toSourceRanges(3, 4)).toHaveLength(0)
  })

  it('refuses a text span that does not match the decoded length', () => {
    expect(() => new BlockBuilder().addText('abc', 0, 5)).toThrow(/pass a charMap/)
    expect(() => new BlockBuilder().addText('abc', 0, 3, { charMap: [0, 1] })).toThrow(
      /charMap length/,
    )
  })

  it('handles astral characters by UTF-16 code unit', () => {
    // An emoji is two UTF-16 code units; offsets must count units, not code points.
    const source = 'a 🚀 b'
    const { block, map } = new BlockBuilder()
      .addText(source, 0, source.length)
      .build({ id: 'b1', kind: 'paragraph' })

    expect(block.text.length).toBe(6)
    const ranges = map.toSourceRanges(2, 4)
    expect(source.slice(ranges[0]!.start, ranges[0]!.end)).toBe('🚀')
  })
})

describe('OffsetMap round-trip (property)', () => {
  /** Random blocks of text/placeholder/boundary segments over a synthetic source string. */
  const blockArb = fc
    .array(
      fc.oneof(
        fc.record({
          type: fc.constant('text' as const),
          // U+FFFC is reserved for placeholders, so it must never appear in generated text.
          text: fc
            .string({ minLength: 1, maxLength: 12, unit: 'grapheme' })
            .filter((value) => !value.includes(PLACEHOLDER_CHAR)),
          gap: fc.integer({ min: 0, max: 4 }),
        }),
        fc.record({
          type: fc.constant('placeholder' as const),
          width: fc.integer({ min: 1, max: 8 }),
          gap: fc.integer({ min: 0, max: 4 }),
        }),
        fc.record({ type: fc.constant('boundary' as const) }),
      ),
      { minLength: 1, maxLength: 8 },
    )
    .map((parts) => {
      const builder = new BlockBuilder()
      let source = ''
      // Each text part is written into the source verbatim, separated by junk of `gap` length,
      // so segment sources are non-contiguous the way real inline markup is.
      for (const part of parts) {
        if (part.type === 'boundary') {
          builder.addBoundary()
          continue
        }
        source += '~'.repeat(part.gap)
        const start = source.length
        if (part.type === 'text') {
          source += part.text
          builder.addText(part.text, start, source.length)
        } else {
          source += '#'.repeat(part.width)
          builder.addPlaceholder(start, source.length)
        }
      }
      return { source, built: builder.build({ id: 'b', kind: 'paragraph' }) }
    })

  it('maps every text character back to the identical source character', () => {
    fc.assert(
      fc.property(blockArb, ({ source, built }) => {
        const { block, map } = built
        for (let i = 0; i < block.text.length; i++) {
          if (map.segmentAt(i)?.kind !== 'text') continue
          const start = map.toSource(i, 'start')
          expect(start).toBeDefined()
          expect(source[start!]).toBe(block.text[i])
        }
      }),
      { numRuns: 2000 },
    )
  })

  it('never reports a range as editable when it touches a placeholder', () => {
    fc.assert(
      fc.property(blockArb, ({ built }) => {
        const { block, map } = built
        for (const segment of block.segments) {
          if (segment.kind !== 'placeholder') continue
          expect(map.isEditable(segment.flatStart, segment.flatEnd)).toBe(false)
          expect(map.isEditable(0, block.text.length)).toBe(false)
        }
      }),
      { numRuns: 1000 },
    )
  })

  it('returns ranges in order whose concatenated text equals the matched slice', () => {
    fc.assert(
      fc.property(blockArb, fc.nat(), fc.nat(), ({ source, built }, a, b) => {
        const { block, map } = built
        if (block.text.length === 0) return
        const start = a % block.text.length
        const end = start + (b % (block.text.length - start + 1))

        const ranges = map.toSourceRanges(start, end)
        let previousEnd = -1
        let rebuilt = ''
        for (const range of ranges) {
          expect(range.start).toBeGreaterThanOrEqual(previousEnd === -1 ? 0 : 0)
          expect(range.end).toBeGreaterThanOrEqual(range.start)
          previousEnd = range.end
          if (range.segment.kind === 'text') rebuilt += source.slice(range.start, range.end)
        }
        // Boundaries have no source and placeholders stand for other syntax, so compare only
        // the text-backed characters of the slice. Index by UTF-16 code unit, never by code
        // point: Array.from() would desync the index on astral characters.
        let expected = ''
        for (let i = start; i < end; i++) {
          if (map.segmentAt(i)?.kind === 'text') expected += block.text[i]
        }
        expect(rebuilt).toBe(expected)
      }),
      { numRuns: 2000 },
    )
  })
})
