import { describe, expect, it } from 'vitest'
import { parseVueSfc, vueAdapter } from '../src/index.ts'

function stampOf(code: string, relativePath = 'src/Hero.vue') {
  return vueAdapter.stamp!(code, { uri: relativePath, relativePath })
}

describe('vue adapter: stamp()', () => {
  it('adds a data-vf attribute to every block-holding element', () => {
    const code = `<template>
      <div>
        <h1>A heading long enough to count</h1>
        <p>A paragraph of real page copy right here.</p>
      </div>
    </template>`
    const result = stampOf(code)
    expect(result.code).toContain('<h1 data-vf="')
    expect(result.code).toContain('<p data-vf="')
    expect(result.entries).toHaveLength(2)
  })

  it('produces code that still parses as valid Vue SFC', () => {
    const code = `<template>
      <div>
        <p>Some text with <strong>bold</strong> in it right here.</p>
      </div>
    </template>`
    const result = stampOf(code)
    expect(() => parseVueSfc(result.code)).not.toThrow()
  })

  it('does not stamp elements with no editable text (empty, or {{ expr }}-only)', () => {
    const code = `<template>
      <div>
        <p></p>
        <p>{{ dynamicOnly }}</p>
      </div>
    </template>`
    const result = stampOf(code)
    expect(result.entries).toHaveLength(0)
  })

  it('does not stamp a v-html element', () => {
    const code = `<template>
      <div>
        <p v-html="rawHtml">fallback</p>
      </div>
    </template>`
    const result = stampOf(code)
    expect(result.entries).toHaveLength(0)
  })

  it('assigns the same id to the same element across two stamp runs (stable across HMR)', () => {
    const code = `<template>
      <div>
        <p>First paragraph with real words in it here.</p>
        <p>Second paragraph with different words in it.</p>
      </div>
    </template>`
    const first = stampOf(code)
    const second = stampOf(code)
    expect(first.entries.map((e) => e.id)).toEqual(second.entries.map((e) => e.id))
  })

  it('assigns different ids to different elements', () => {
    const code = `<template>
      <div>
        <p>First paragraph with real words in it here.</p>
        <p>Second paragraph with different words in it.</p>
      </div>
    </template>`
    const result = stampOf(code)
    const ids = result.entries.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('assigns the same id across an unrelated edit elsewhere in the file (stable identity)', () => {
    const before = `<script setup>
    const a = 1
    </script>
    <template>
      <div>
        <p>First paragraph with real words in it here.</p>
        <p>Second paragraph with different words in it.</p>
      </div>
    </template>`
    const after = `<script setup>
    // an unrelated comment added above
    const a = 1
    </script>
    <template>
      <div>
        <p>First paragraph with real words in it here.</p>
        <p>Second paragraph with different words in it.</p>
      </div>
    </template>`
    const beforeIds = stampOf(before).entries.map((e) => e.id)
    const afterIds = stampOf(after).entries.map((e) => e.id)
    expect(afterIds).toEqual(beforeIds)
  })

  it('records refs matching exactly what extract() reports as editable for the same block', () => {
    const code = `<template>
      <div>
        <p>We utilize a robust plan every day for everyone here.</p>
      </div>
    </template>`
    const result = stampOf(code)
    const document = vueAdapter.extract(code, {
      uri: 'src/Hero.vue',
    }) as import('@voxfold/core').ProseDocument
    const block = document.blocks[0]!
    const editableRefs = block.segments
      .filter((s) => s.kind === 'text' && s.editable && s.node)
      .map((s) => s.node!.path)

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.refs.map((r) => r.path)).toEqual(editableRefs)
  })

  it('returns a source map that names the relative path', () => {
    const code = `<template><p>A paragraph with several words in it.</p></template>`
    const result = stampOf(code, 'components/Card.vue')
    expect(result.map).toBeDefined()
    expect(JSON.stringify(result.map)).toContain('components/Card.vue')
  })
})
