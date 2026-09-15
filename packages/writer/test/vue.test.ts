import { readFileSync } from 'node:fs'
import { vueAdapter } from '@voxfold/lang-vue'
import { afterEach, describe, expect, it } from 'vitest'
import { sha256 } from '../src/hash.ts'
import { applyEditRequest } from '../src/protocol.ts'
import { cleanup, extractSync, findSegment, makeTrackedRepo } from './helpers.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) cleanup(dir)
})

function setup(content: string) {
  const { dir, file } = makeTrackedRepo('Component.vue', content)
  dirs.push(dir)
  return { dir, file }
}

describe('applyEditRequest: Vue', () => {
  it('applies a word replacement inside a paragraph', () => {
    const content =
      '<template>\n  <p>We utilize a robust platform every day for our whole team.</p>\n</template>\n'
    const { file, dir } = setup(content)
    const document = extractSync(vueAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: vueAdapter,
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
      '<template>\n  <div><p>Some intro copy with plenty of its own words here.</p>' +
      '<p>We <strong>utilize</strong> modern tooling for absolutely everything we build.</p></div>\n</template>\n'
    const { file, dir } = setup(content)
    const document = extractSync(vueAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: vueAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('<strong>utilize</strong>', '<strong>use</strong>'))
  })

  it('escapes a literal < or {{ typed into the replacement', () => {
    const content =
      '<template>\n  <p>Our platform handles requests quickly and reliably.</p>\n</template>\n'
    const { file, dir } = setup(content)
    const document = extractSync(vueAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'quickly')

    const result = applyEditRequest(
      {
        file,
        adapter: vueAdapter,
        expectedFileHash: sha256(content),
        targets: [
          {
            ref,
            expectedOldText: oldText,
            newText: oldText.replace('quickly', 'fast {{and}} <right>'),
          },
        ],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toContain('fast &lbrace;&lbrace;and&rbrace;&rbrace; &lt;right>')
  })

  it('decodes and re-encodes an HTML entity already present in template text', () => {
    const content =
      '<template>\n  <p>Tom &amp; Jerry utilize a robust platform daily for everyone.</p>\n</template>\n'
    const { file, dir } = setup(content)
    const document = extractSync(vueAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: vueAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('utilize', 'use'))
    expect(result.newText).toContain('Tom &amp; Jerry use')
  })

  it('applies a multiline edit inside a paragraph whose text spans several source lines', () => {
    // The flat block text collapses whitespace, but the writer still edits the SAME underlying
    // template text node — a fix confined to one word still lands correctly even though the
    // node's raw source spans three lines.
    const content =
      '<template>\n  <p>\n    We utilize a robust plan every day for everyone here.\n  </p>\n</template>\n'
    const { file, dir } = setup(content)
    const document = extractSync(vueAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: vueAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('We utilize', 'We use'))
  })
})
