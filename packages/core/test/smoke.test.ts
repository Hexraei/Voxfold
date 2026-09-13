import { describe, expect, it } from 'vitest'
import * as core from '../src/index'

describe('@voxfold/core public surface', () => {
  it('exports the flattening, text and tagging entry points adapters depend on', () => {
    for (const name of [
      'BlockBuilder',
      'OffsetMap',
      'mapOf',
      'tokenize',
      'countWords',
      'splitSentences',
      'normalizeForMatch',
      'defaultTagger',
      'CompromiseTagger',
      'PLACEHOLDER_CHAR',
    ]) {
      expect(core, `missing export: ${name}`).toHaveProperty(name)
    }
  })

  it('flattens, tokenizes and tags through the public API alone', () => {
    const { block, map } = new core.BlockBuilder()
      .addText('The dashboard quietly syncs', 0, 27)
      .build({ id: 'b1', kind: 'paragraph' })

    const tokens = core.tokenize(block.text)
    expect(core.countWords(tokens)).toBe(4)

    const tagged = core.defaultTagger.tag(block.text, tokens)
    expect(tagged.find((t) => t.token.raw === 'quietly')?.tag).toBe('ADV')
    expect(map.isEditable(0, block.text.length)).toBe(true)
  })
})
