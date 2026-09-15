import { readFileSync } from 'node:fs'
import { markdownAdapter } from '@voxfold/lang-markdown'
import { afterEach, describe, expect, it } from 'vitest'
import { sha256 } from '../src/hash.ts'
import { applyEditRequest } from '../src/protocol.ts'
import { cleanup, extractSync, findSegment, makeTrackedRepo } from './helpers.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) cleanup(dir)
})

function setup(content: string) {
  const { dir, file } = makeTrackedRepo('README.md', content)
  dirs.push(dir)
  return { dir, file }
}

function apply(
  file: string,
  dir: string,
  content: string,
  ref: ReturnType<typeof findSegment>['ref'],
  oldText: string,
  newText: string,
) {
  return applyEditRequest(
    {
      file,
      adapter: markdownAdapter,
      expectedFileHash: sha256(content),
      targets: [{ ref, expectedOldText: oldText, newText }],
    },
    { projectRoot: dir },
  )
}

describe('applyEditRequest: Markdown', () => {
  it('applies a word replacement inside a paragraph', () => {
    const content = 'We utilize a robust platform every day for our whole team.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = apply(file, dir, content, ref, oldText, oldText.replace('utilize', 'use'))

    expect(result.newText).toBe(content.replace('utilize', 'use'))
    expect(readFileSync(file, 'utf8')).toBe(result.newText)
  })

  it('applies an edit inside emphasis without disturbing the asterisks', () => {
    const content =
      'Some intro copy with plenty of its own words here.\n\n' +
      'We **utilize** modern tooling for absolutely everything we build.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = apply(file, dir, content, ref, oldText, oldText.replace('utilize', 'use'))

    expect(result.newText).toBe(content.replace('**utilize**', '**use**'))
  })

  it('escapes emphasis/link-special characters typed into the replacement', () => {
    const content = 'Our platform handles requests quickly and reliably.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'quickly')

    const result = apply(
      file,
      dir,
      content,
      ref,
      oldText,
      oldText.replace('quickly', 'fast *not-italic* [not-a-link] here'),
    )

    expect(result.newText).toContain('fast \\*not-italic\\* \\[not-a-link\\] here')
    expect(readFileSync(file, 'utf8')).toBe(result.newText)
  })

  it('escapes a leading "#" so the edited text does not become a heading', () => {
    const content = 'Plain text starts a paragraph right here today.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(
      document,
      'Plain text starts a paragraph right here today.',
    )

    const result = apply(file, dir, content, ref, oldText, '# Not a heading, just edited text.')

    expect(result.newText).toBe('\\# Not a heading, just edited text.\n')
    // Re-extract and confirm the escaped text really is read back as ONE paragraph, not a heading.
    const reDocument = extractSync(markdownAdapter, result.newText, { uri: file })
    expect(reDocument.blocks).toHaveLength(1)
    expect(reDocument.blocks[0]!.kind).toBe('paragraph')
    expect(reDocument.blocks[0]!.text).toBe('# Not a heading, just edited text.')
  })

  it('escapes a leading "- " so the edited text does not become a list item', () => {
    const content = 'Plain text starts a paragraph right here today.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(
      document,
      'Plain text starts a paragraph right here today.',
    )

    const result = apply(file, dir, content, ref, oldText, '- Not a list, just edited text.')

    const reDocument = extractSync(markdownAdapter, result.newText, { uri: file })
    expect(reDocument.blocks).toHaveLength(1)
    expect(reDocument.blocks[0]!.kind).toBe('paragraph')
    expect(reDocument.blocks[0]!.text).toBe('- Not a list, just edited text.')
  })

  it('escapes a leading ordered-list marker ("1. ") so it stays plain text', () => {
    const content = 'Plain text starts a paragraph right here today.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(
      document,
      'Plain text starts a paragraph right here today.',
    )

    const result = apply(file, dir, content, ref, oldText, '1. Not a list, just edited text.')

    const reDocument = extractSync(markdownAdapter, result.newText, { uri: file })
    expect(reDocument.blocks).toHaveLength(1)
    expect(reDocument.blocks[0]!.kind).toBe('paragraph')
    expect(reDocument.blocks[0]!.text).toBe('1. Not a list, just edited text.')
  })

  it('escapes a pipe inside a table cell so the cell count does not change', () => {
    const content = '| a | b |\n| --- | --- |\n| pipe here word | c |\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'pipe here word')

    const result = apply(file, dir, content, ref, oldText, 'pipe | here word')

    const reDocument = extractSync(markdownAdapter, result.newText, { uri: file })
    const cell = reDocument.blocks.find((b) => b.text.includes('pipe'))!
    expect(cell.text).toBe('pipe | here word')
  })

  it("applies an edit inside a link's text without touching the URL", () => {
    const content = 'Read the [full documentation here](https://example.com/docs) for more.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'full documentation here')

    const result = apply(
      file,
      dir,
      content,
      ref,
      oldText,
      oldText.replace('full documentation here', 'complete guide here'),
    )

    expect(result.newText).toContain('[complete guide here](https://example.com/docs)')
  })

  it('decodes and re-encodes an escaped character already present in the source', () => {
    const content = 'Tom \\* Jerry utilize a robust platform daily for everyone.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = apply(file, dir, content, ref, oldText, oldText.replace('utilize', 'use'))

    expect(result.newText).toBe(content.replace('utilize', 'use'))
    expect(result.newText).toContain('Tom \\* Jerry use')
  })
})
