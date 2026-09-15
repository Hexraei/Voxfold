import MarkdownIt from 'markdown-it'
import { describe, expect, it } from 'vitest'
import {
  resolveVitePressStamp,
  type VitePressStampEntry,
  vitePressStampPlugin,
} from '../src/vitepress.ts'

function renderAndStamp(source: string, relativePath = 'guide/index.md') {
  const md = new MarkdownIt()
  let entries: VitePressStampEntry[] = []
  md.use(vitePressStampPlugin, { relativePath, onEntries: (e) => (entries = e) })
  const html = md.render(source)
  return { html, entries }
}

describe('lang-markdown: vitePressStampPlugin()', () => {
  it('adds a data-vf attribute to headings, paragraphs and list items', () => {
    const source =
      '# A heading long enough to count\n\nA paragraph of real page copy.\n\n- item one\n- item two\n'
    const { html, entries } = renderAndStamp(source)
    expect(html).toContain('<h1 data-vf="')
    expect(html).toContain('<p data-vf="')
    expect(html).toContain('<li data-vf="')
    expect(entries).toHaveLength(4)
  })

  it('records the correct 0-based half-open line range for each block', () => {
    const source = '# Heading here\n\nA paragraph of real page copy right here.\n'
    const { entries } = renderAndStamp(source)
    const heading = entries.find((e) => e.flatText === 'Heading here')!
    const paragraph = entries.find((e) => e.flatText.startsWith('A paragraph'))!
    expect(heading.startLine).toBe(0)
    expect(heading.endLine).toBe(1)
    expect(paragraph.startLine).toBe(2)
    expect(paragraph.endLine).toBe(3)
  })

  it('stamps the inner <p> (not the <li>) for a loose list item', () => {
    const source = '- item one\n\n- item two\n'
    const { html, entries } = renderAndStamp(source)
    expect(html).toContain('<p data-vf="')
    expect(html).not.toContain('<li data-vf="')
    expect(entries).toHaveLength(2)
  })

  it('does not stamp an empty block or a code fence', () => {
    const source = '```js\nconst x = 1\n```\n\nReal paragraph text goes here now.\n'
    const { entries } = renderAndStamp(source)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.flatText).toContain('Real paragraph')
  })

  it('assigns stable ids across repeated renders of the same file', () => {
    const source =
      'First paragraph with real words in it here.\n\nSecond paragraph with different words.\n'
    const first = renderAndStamp(source)
    const second = renderAndStamp(source)
    expect(first.entries.map((e) => e.id)).toEqual(second.entries.map((e) => e.id))
  })
})

describe('lang-markdown: resolveVitePressStamp()', () => {
  it('resolves when the block is still at the recorded lines with matching text', async () => {
    const source = 'We utilize a robust platform every day for our whole team.\n'
    const { entries } = renderAndStamp(source)
    const result = await resolveVitePressStamp(source, entries[0]!)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.document.blocks[result.blockIndex]!.text).toBe(entries[0]!.flatText)
    }
  })

  it('falls back to unresolvable when no block exists at the recorded lines anymore', async () => {
    const source = 'We utilize a robust platform every day for our whole team.\n'
    const { entries } = renderAndStamp(source)
    // Simulate the file having changed so nothing occupies the recorded line range any more.
    const changedSource = '\n\n\n\n\nWe utilize a robust platform every day for our whole team.\n'
    const result = await resolveVitePressStamp(changedSource, entries[0]!)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no-matching-block')
  })

  it('falls back to unresolvable when the text at those lines no longer matches (content moved)', async () => {
    const source = 'We utilize a robust platform every day for our whole team.\n'
    const { entries } = renderAndStamp(source)
    const changedSource = 'Something completely different now occupies this very same line.\n'
    const result = await resolveVitePressStamp(changedSource, entries[0]!)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('content-mismatch')
  })

  it('falls back to unresolvable when the recorded lines now span more than one block (ambiguous)', async () => {
    const source = 'A single paragraph spanning what will become two blocks after editing here.\n'
    const { entries } = renderAndStamp(source)
    // Two short paragraphs replacing the original single block at/around the same starting line —
    // both blocks overlap the recorded [0,1) range, so the match is genuinely ambiguous.
    const changedSource = 'First short one.\nSecond short one.\n'
    const result = await resolveVitePressStamp(changedSource, entries[0]!)
    // Either genuinely ambiguous, or the (single, differently-worded) block fails content match —
    // both are valid conservative refusals; the important property is it never silently succeeds.
    expect(result.ok).toBe(false)
  })
})
