import type { StampEntry } from '@voxfold/core'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'
import { stampRehype } from '../src/stamp.ts'

async function render(source: string, relativePath = 'index.md') {
  let entries: StampEntry[] = []
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(() => stampRehype(source, { relativePath, mdx: false, onEntries: (e) => (entries = e) }))
    .use(rehypeStringify)
    .process(source)
  return { html: String(file), entries }
}

describe('lang-markdown: stampRehype()', () => {
  it('adds a data-vf attribute to every rendered block-holding element', async () => {
    const source = '# A heading long enough to count\n\nA paragraph of real page copy.\n'
    const { html, entries } = await render(source)
    expect(html).toContain('<h1 data-vf="')
    expect(html).toContain('<p data-vf="')
    expect(entries).toHaveLength(2)
  })

  it('stamps list items individually', async () => {
    const source = '- A list item with several words\n- Another item right here too\n'
    const { html, entries } = await render(source)
    expect(html).toContain('<li data-vf="')
    expect(entries).toHaveLength(2)
    expect(new Set(entries.map((e) => e.id)).size).toBe(2)
  })

  it('records refs that resolve through the same markdownWriter extract() uses', async () => {
    const source = 'We utilize a robust platform every day for our whole team.\n'
    const { entries } = await render(source)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.refs.length).toBeGreaterThan(0)
    expect(entries[0]!.refs[0]!.type).toBe('text')
    expect(entries[0]!.format).toBe('markdown')
  })

  it('assigns the same id to the same block across two runs (stable across rebuilds)', async () => {
    const source =
      'First paragraph with real words in it here.\n\nSecond paragraph with different words.\n'
    const first = await render(source)
    const second = await render(source)
    expect(first.entries.map((e) => e.id)).toEqual(second.entries.map((e) => e.id))
  })

  it('does not stamp a code block or other non-prose content', async () => {
    const source =
      '```js\nconst x = 1 // we utilize this in code, never linted\n```\n\nA real paragraph here now.\n'
    const { entries } = await render(source)
    expect(entries).toHaveLength(1)
  })

  it('produces different ids for different relative paths (same content, different file)', async () => {
    const source = 'A paragraph with several words in it right here.\n'
    const a = await render(source, 'docs/a.md')
    const b = await render(source, 'docs/b.md')
    expect(a.entries[0]!.id).not.toBe(b.entries[0]!.id)
  })
})
