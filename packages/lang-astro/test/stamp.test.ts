import type { ProseDocument } from '@voxfold/core'
import { describe, expect, it } from 'vitest'
import { astroAdapter, parseAstroFileSync } from '../src/index.ts'

const FRONTMATTER = '---\nconst title = "hi"\n---\n'

function stampOf(template: string, relativePath = 'src/Hero.astro') {
  return astroAdapter.stamp!(`${FRONTMATTER}${template}`, { uri: relativePath, relativePath })
}

describe('astro adapter: stamp()', () => {
  it('adds a data-vf attribute to every block-holding element', () => {
    const template = `
      <div>
        <h1>A heading long enough to count</h1>
        <p>A paragraph of real page copy right here.</p>
      </div>
    `
    const result = stampOf(template)
    expect(result.code).toContain('<h1 data-vf="')
    expect(result.code).toContain('<p data-vf="')
    expect(result.entries).toHaveLength(2)
  })

  it('produces code that still parses as valid Astro', () => {
    const template = `
      <div>
        <p>Some text with <strong>bold</strong> in it right here.</p>
      </div>
    `
    const result = stampOf(template)
    expect(() => parseAstroFileSync(result.code)).not.toThrow()
  })

  it('does not stamp elements with no editable text (empty, or {expr}-only)', () => {
    const template = `
      <div>
        <p></p>
        <p>{dynamicOnly}</p>
      </div>
    `
    const result = stampOf(template)
    expect(result.entries).toHaveLength(0)
  })

  it('does not stamp a set:html-only element', () => {
    const template = `
      <div>
        <p set:html={rawContent}></p>
      </div>
    `
    const result = stampOf(template)
    expect(result.entries).toHaveLength(0)
  })

  it('assigns the same id to the same element across two stamp runs (stable across HMR)', () => {
    const template = `
      <div>
        <p>First paragraph with real words in it here.</p>
        <p>Second paragraph with different words in it.</p>
      </div>
    `
    const first = stampOf(template)
    const second = stampOf(template)
    expect(first.entries.map((e) => e.id)).toEqual(second.entries.map((e) => e.id))
  })

  it('assigns different ids to different elements', () => {
    const template = `
      <div>
        <p>First paragraph with real words in it here.</p>
        <p>Second paragraph with different words in it.</p>
      </div>
    `
    const result = stampOf(template)
    const ids = result.entries.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('assigns the same id across an unrelated edit in the frontmatter (stable identity)', () => {
    const before = `${FRONTMATTER}<div>\n  <p>First paragraph with real words in it here.</p>\n</div>`
    const after = `---\nconst title = "hi"\nconst extra = 1\n---\n<div>\n  <p>First paragraph with real words in it here.</p>\n</div>`
    const beforeIds = astroAdapter.stamp!(before, {
      uri: 'x',
      relativePath: 'x.astro',
    }).entries.map((e) => e.id)
    const afterIds = astroAdapter.stamp!(after, { uri: 'x', relativePath: 'x.astro' }).entries.map(
      (e) => e.id,
    )
    expect(afterIds).toEqual(beforeIds)
  })

  it('records refs matching exactly what extract() reports as editable for the same block', () => {
    const template = `
      <div>
        <p>We utilize a robust plan every day for everyone here.</p>
      </div>
    `
    const result = stampOf(template)
    const document = astroAdapter.extract(`${FRONTMATTER}${template}`, {
      uri: 'src/Hero.astro',
    }) as unknown as Promise<ProseDocument>
    return document.then((doc) => {
      const block = doc.blocks[0]!
      const editableRefs = block.segments
        .filter((s) => s.kind === 'text' && s.editable && s.node)
        .map((s) => s.node!.path)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0]!.refs.map((r) => r.path)).toEqual(editableRefs)
    })
  })

  it('returns a source map that names the relative path', () => {
    const result = stampOf(`<p>A paragraph with several words in it.</p>`, 'components/Card.astro')
    expect(result.map).toBeDefined()
    expect(JSON.stringify(result.map)).toContain('components/Card.astro')
  })
})
