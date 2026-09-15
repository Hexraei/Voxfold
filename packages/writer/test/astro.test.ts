import { readFileSync } from 'node:fs'
import type { ProseDocument } from '@voxfold/core'
import { astroAdapter } from '@voxfold/lang-astro'
import { afterEach, describe, expect, it } from 'vitest'
import { sha256 } from '../src/hash.ts'
import { applyEditRequest } from '../src/protocol.ts'
import { cleanup, findSegment, makeTrackedRepo } from './helpers.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) cleanup(dir)
})

function setup(content: string) {
  const { dir, file } = makeTrackedRepo('Component.astro', content)
  dirs.push(dir)
  return { dir, file }
}

/** Astro's extract() is async (see lang-astro's module doc); the writer's own parse/locate/encode
 * hooks are sync, but building a test's starting NodeRef still needs a real extracted document. */
async function extractAstro(text: string, uri: string): Promise<ProseDocument> {
  return (await astroAdapter.extract(text, { uri })) as ProseDocument
}

describe('applyEditRequest: Astro', () => {
  it('applies a word replacement inside a paragraph', async () => {
    const content =
      '---\nconst title = "hi"\n---\n<p>We utilize a robust platform every day for our whole team.</p>\n'
    const { file, dir } = setup(content)
    const document = await extractAstro(content, file)
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: astroAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('utilize', 'use'))
    expect(readFileSync(file, 'utf8')).toBe(result.newText)
  })

  it('applies an edit inside a <strong> tag without disturbing the tag', async () => {
    const content =
      '---\nconst title = "hi"\n---\n<div><p>Some intro copy with plenty of its own words here.</p>' +
      '<p>We <strong>utilize</strong> modern tooling for absolutely everything we build.</p></div>\n'
    const { file, dir } = setup(content)
    const document = await extractAstro(content, file)
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: astroAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('<strong>utilize</strong>', '<strong>use</strong>'))
  })

  it('escapes a literal < or { typed into the replacement', async () => {
    const content =
      '---\nconst title = "hi"\n---\n<p>Our platform handles requests quickly and reliably.</p>\n'
    const { file, dir } = setup(content)
    const document = await extractAstro(content, file)
    const { ref, oldText } = findSegment(document, 'quickly')

    const result = applyEditRequest(
      {
        file,
        adapter: astroAdapter,
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
    expect(readFileSync(file, 'utf8')).toBe(result.newText)
  })

  it('applies a multibyte edit ahead of an ASCII target (the spike-relevant case)', async () => {
    const content =
      '---\nconst title = "hi"\n---\n<p>Emoji 😀 and curly "quotes" precede this: we utilize daily.</p>\n'
    const { file, dir } = setup(content)
    const document = await extractAstro(content, file)
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: astroAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('we utilize', 'we use'))
    expect(readFileSync(file, 'utf8')).toBe(result.newText)
  })

  it("applies an edit inside a component's slotted text", async () => {
    const content =
      '---\nconst title = "hi"\n---\n<p>Intro copy <Badge>we utilize a robust label right here</Badge> after.</p>\n'
    const { file, dir } = setup(content)
    const document = await extractAstro(content, file)
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: astroAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('we utilize', 'we use'))
  })
})
