import { readFileSync } from 'node:fs'
import { jsxAdapter } from '@voxfold/lang-jsx'
import { afterEach, describe, expect, it } from 'vitest'
import { sha256 } from '../src/hash.ts'
import { applyEditRequest } from '../src/protocol.ts'
import { cleanup, extractSync, findSegment, makeTrackedRepo } from './helpers.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) cleanup(dir)
})

function setup(content: string) {
  const { dir, file } = makeTrackedRepo('Component.tsx', content)
  dirs.push(dir)
  return { dir, file }
}

describe('applyEditRequest: JSX', () => {
  it('applies a word replacement inside a paragraph', () => {
    const content = 'const x = <p>We utilize a robust platform every day for our whole team.</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(jsxAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: jsxAdapter,
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
      'const x = <div><p>Some intro copy with plenty of its own words here.</p>' +
      '<p>We <strong>utilize</strong> modern tooling for absolutely everything we build.</p></div>\n'
    const { file, dir } = setup(content)
    const document = extractSync(jsxAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: jsxAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('<strong>utilize</strong>', '<strong>use</strong>'))
  })

  it('escapes a literal < or { typed into the replacement', () => {
    const content = 'const x = <p>Our platform handles requests quickly and reliably.</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(jsxAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'quickly')

    const result = applyEditRequest(
      {
        file,
        adapter: jsxAdapter,
        expectedFileHash: sha256(content),
        targets: [
          {
            ref,
            expectedOldText: oldText,
            newText: oldText.replace('quickly', 'fast {and} <right>'),
          },
        ],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toContain('fast &#123;and&#125; &lt;right>')
  })

  it('decodes and re-encodes an HTML entity already present in JSXText', () => {
    const content =
      'const x = <p>Tom &amp; Jerry utilize a robust platform daily for everyone.</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(jsxAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: jsxAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('utilize', 'use'))
    expect(result.newText).toContain('Tom &amp; Jerry use')
  })

  it('applies an edit inside a string-literal JSX child, preserving its quotes', () => {
    const content =
      'const x = <p>{"We utilize a robust literal plan for everyone here today."}</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(jsxAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: jsxAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('utilize', 'use'))
    expect(result.newText).toContain('{"We use a robust')
  })

  it('applies an edit inside a single-quoted string-literal JSX child', () => {
    const content = `const x = <p>{'We utilize a robust literal plan for everyone here today.'}</p>\n`
    const { file, dir } = setup(content)
    const document = extractSync(jsxAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: jsxAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('utilize', 'use'))
    expect(result.newText).toContain(`{'We use a robust`)
  })

  it('refuses to write across a JSX whitespace-collapse boundary (multi-line text)', () => {
    // The flat block text collapses this into one sentence, but the writer still edits the SAME
    // underlying JSXText node — a fix confined to one word still lands correctly even though the
    // node's raw source spans three lines.
    const content =
      'const x = (\n  <p>\n    We utilize a robust plan every day for everyone here.\n  </p>\n)\n'
    const { file, dir } = setup(content)
    const document = extractSync(jsxAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: jsxAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('We utilize', 'We use'))
  })
})
