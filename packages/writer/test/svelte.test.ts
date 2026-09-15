import { readFileSync } from 'node:fs'
import { svelteAdapter } from '@voxfold/lang-svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { sha256 } from '../src/hash.ts'
import { applyEditRequest } from '../src/protocol.ts'
import { cleanup, extractSync, findSegment, makeTrackedRepo } from './helpers.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) cleanup(dir)
})

function setup(content: string) {
  const { dir, file } = makeTrackedRepo('Component.svelte', content)
  dirs.push(dir)
  return { dir, file }
}

describe('applyEditRequest: Svelte', () => {
  it('applies a word replacement inside a paragraph', () => {
    const content = '<p>We utilize a robust platform every day for our whole team.</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(svelteAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: svelteAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('utilize', 'use'))
    expect(readFileSync(file, 'utf8')).toBe(result.newText)
  })

  it('applies an edit inside a <strong> tag without disturbing the tag', () => {
    const content =
      '<div><p>Some intro copy with plenty of its own words here.</p>' +
      '<p>We <strong>utilize</strong> modern tooling for absolutely everything we build.</p></div>\n'
    const { file, dir } = setup(content)
    const document = extractSync(svelteAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: svelteAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('<strong>utilize</strong>', '<strong>use</strong>'))
  })

  it('escapes a literal < or { typed into the replacement', () => {
    const content = '<p>Our platform handles requests quickly and reliably.</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(svelteAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'quickly')

    const result = applyEditRequest(
      {
        file,
        adapter: svelteAdapter,
        expectedFileHash: sha256(content),
        targets: [
          {
            ref,
            expectedOldText: oldText,
            newText: oldText.replace('quickly', 'fast {evil} <right>'),
          },
        ],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toContain('fast &lbrace;evil&rbrace; &lt;right>')
  })

  it('decodes and re-encodes an HTML entity already present in template text', () => {
    const content = '<p>Tom &amp; Jerry utilize a robust platform daily for everyone.</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(svelteAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: svelteAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('utilize', 'use'))
    expect(result.newText).toContain('Tom &amp; Jerry use')
  })

  it('applies a multiline edit inside a paragraph whose text spans several source lines', () => {
    // Svelte does not collapse whitespace (unlike Vue), so the flat block text keeps the raw
    // newline+indent run verbatim — the writer still patches the SAME underlying Text node.
    const content = '<p>\n    We utilize a robust plan every day for everyone here.\n  </p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(svelteAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: svelteAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('We utilize', 'We use'))
  })

  it('applies an edit inside an {#if} branch (statically-authored prose, not locked)', () => {
    const content = '<p>{#if ready}We utilize a robust plan every single day.{/if}</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(svelteAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: svelteAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('utilize', 'use'))
  })
})
