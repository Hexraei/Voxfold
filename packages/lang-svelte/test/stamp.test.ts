import { describe, expect, it } from 'vitest'
import { parseSvelteFile, svelteAdapter } from '../src/index.ts'

function stampOf(code: string, relativePath = 'src/Hero.svelte') {
  return svelteAdapter.stamp!(code, { uri: relativePath, relativePath })
}

describe('svelte adapter: stamp()', () => {
  it('adds a data-vf attribute to every block-holding element', () => {
    const code = `
      <div>
        <h1>A heading long enough to count</h1>
        <p>A paragraph of real page copy right here.</p>
      </div>
    `
    const result = stampOf(code)
    expect(result.code).toContain('<h1 data-vf="')
    expect(result.code).toContain('<p data-vf="')
    expect(result.entries).toHaveLength(2)
  })

  it('produces code that still parses as valid Svelte', () => {
    const code = `
      <div>
        <p>Some text with <strong>bold</strong> in it right here.</p>
      </div>
    `
    const result = stampOf(code)
    expect(() => parseSvelteFile(result.code)).not.toThrow()
  })

  it('does not stamp elements with no editable text (empty, or {expr}-only)', () => {
    const code = `
      <div>
        <p></p>
        <p>{dynamicOnly}</p>
      </div>
    `
    const result = stampOf(code)
    expect(result.entries).toHaveLength(0)
  })

  it('does not stamp a {@html}-only element', () => {
    const code = `
      <div>
        <p>{@html rawContent}</p>
      </div>
    `
    const result = stampOf(code)
    expect(result.entries).toHaveLength(0)
  })

  it('assigns the same id to the same element across two stamp runs (stable across HMR)', () => {
    const code = `
      <div>
        <p>First paragraph with real words in it here.</p>
        <p>Second paragraph with different words in it.</p>
      </div>
    `
    const first = stampOf(code)
    const second = stampOf(code)
    expect(first.entries.map((e) => e.id)).toEqual(second.entries.map((e) => e.id))
  })

  it('assigns different ids to different elements', () => {
    const code = `
      <div>
        <p>First paragraph with real words in it here.</p>
        <p>Second paragraph with different words in it.</p>
      </div>
    `
    const result = stampOf(code)
    const ids = result.entries.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('assigns the same id across an unrelated edit elsewhere in the file (stable identity)', () => {
    const before = `<script>
    let a = 1
    </script>
    <div>
      <p>First paragraph with real words in it here.</p>
      <p>Second paragraph with different words in it.</p>
    </div>`
    const after = `<script>
    // an unrelated comment added above
    let a = 1
    </script>
    <div>
      <p>First paragraph with real words in it here.</p>
      <p>Second paragraph with different words in it.</p>
    </div>`
    const beforeIds = stampOf(before).entries.map((e) => e.id)
    const afterIds = stampOf(after).entries.map((e) => e.id)
    expect(afterIds).toEqual(beforeIds)
  })

  it('records refs matching exactly what extract() reports as editable for the same block', () => {
    const code = `
      <div>
        <p>We utilize a robust plan every day for everyone here.</p>
      </div>
    `
    const result = stampOf(code)
    const document = svelteAdapter.extract(code, {
      uri: 'src/Hero.svelte',
    }) as import('@voxfold/core').ProseDocument
    const block = document.blocks[0]!
    const editableRefs = block.segments
      .filter((s) => s.kind === 'text' && s.editable && s.node)
      .map((s) => s.node!.path)

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.refs.map((r) => r.path)).toEqual(editableRefs)
  })

  it('returns a source map that names the relative path', () => {
    const code = `<p>A paragraph with several words in it.</p>`
    const result = stampOf(code, 'components/Card.svelte')
    expect(result.map).toBeDefined()
    expect(JSON.stringify(result.map)).toContain('components/Card.svelte')
  })
})
