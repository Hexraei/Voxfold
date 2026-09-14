import { readFileSync } from 'node:fs'
import { htmlAdapter } from '@voxfold/lang-html'
import { afterEach, describe, expect, it } from 'vitest'
import { sha256 } from '../src/hash.ts'
import { applyEditRequest } from '../src/protocol.ts'
import { cleanup, extractSync, findSegment, makeTrackedRepo } from './helpers.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) cleanup(dir)
})

function setup(content: string) {
  const { dir, file } = makeTrackedRepo('page.html', content)
  dirs.push(dir)
  return { dir, file }
}

describe('applyEditRequest: HTML', () => {
  it('applies a word replacement inside a paragraph', () => {
    const content =
      '<html><body><p>We utilize a robust platform every day for our whole team.</p></body></html>\n'
    const { file, dir } = setup(content)
    const document = extractSync(htmlAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: htmlAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('utilize', 'use'))
    expect(readFileSync(file, 'utf8')).toBe(result.newText)
  })

  it('applies an edit inside a <b> tag without disturbing the tag', () => {
    const content =
      '<html><body><p>Some intro copy with plenty of its own words here.</p>' +
      '<p>We <b>utilize</b> modern tooling for absolutely everything we build.</p></body></html>\n'
    const { file, dir } = setup(content)
    const document = extractSync(htmlAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: htmlAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('<b>utilize</b>', '<b>use</b>'))
  })

  it('escapes a literal & or < typed into the replacement', () => {
    const content =
      '<html><body><p>Our platform handles requests quickly and reliably.</p></body></html>\n'
    const { file, dir } = setup(content)
    const document = extractSync(htmlAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'quickly')

    const result = applyEditRequest(
      {
        file,
        adapter: htmlAdapter,
        expectedFileHash: sha256(content),
        targets: [
          { ref, expectedOldText: oldText, newText: oldText.replace('quickly', 'fast & <right>') },
        ],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toContain('fast &amp; &lt;right>')
  })

  it('decodes and re-encodes an entity already present in the source', () => {
    const content =
      '<html><body><p>Tom &amp; Jerry utilize a robust platform daily for everyone.</p></body></html>\n'
    const { file, dir } = setup(content)
    const document = extractSync(htmlAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: htmlAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('utilize', 'use'))
    expect(result.newText).toContain('Tom &amp; Jerry use')
  })
})
