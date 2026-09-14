import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { markdownAdapter } from '@voxfold/lang-markdown'
import { afterEach, describe, expect, it } from 'vitest'
import { WriteError } from '../src/errors.ts'
import { sha256 } from '../src/hash.ts'
import { applyEditRequest } from '../src/protocol.ts'
import { undoLast } from '../src/undo.ts'
import { cleanup, extractSync, findSegment, makeTrackedRepo } from './helpers.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) cleanup(dir)
})

describe('undoLast', () => {
  it('restores the file to its content before the last write', () => {
    const content = 'We utilize a robust platform every day for our whole growing team here.\n'
    const { dir, file } = makeTrackedRepo('doc.md', content)
    dirs.push(dir)
    const historyDir = join(dir, '.voxfold', 'history')

    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')
    applyEditRequest(
      {
        file,
        adapter: markdownAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir, historyDir },
    )

    expect(readFileSync(file, 'utf8')).not.toBe(content)
    undoLast(file, historyDir)
    expect(readFileSync(file, 'utf8')).toBe(content)
  })

  it('restores the most recent of several edits, not an earlier one', () => {
    const content = 'We utilize a robust platform every day for our whole growing team here.\n'
    const { dir, file } = makeTrackedRepo('doc.md', content)
    dirs.push(dir)
    const historyDir = join(dir, '.voxfold', 'history')

    const doc1 = extractSync(markdownAdapter, content, { uri: file })
    const { ref: ref1, oldText: old1 } = findSegment(doc1, 'utilize')
    const afterFirst = applyEditRequest(
      {
        file,
        adapter: markdownAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref: ref1, expectedOldText: old1, newText: old1.replace('utilize', 'use') }],
      },
      { projectRoot: dir, historyDir },
    ).newText

    const doc2 = extractSync(markdownAdapter, afterFirst, { uri: file })
    const { ref: ref2, oldText: old2 } = findSegment(doc2, 'robust')
    applyEditRequest(
      {
        file,
        adapter: markdownAdapter,
        expectedFileHash: sha256(afterFirst),
        targets: [{ ref: ref2, expectedOldText: old2, newText: old2.replace('robust', 'solid') }],
      },
      { projectRoot: dir, historyDir },
    )

    // One undo should return to the state right after the first edit, not the very original.
    undoLast(file, historyDir)
    expect(readFileSync(file, 'utf8')).toBe(afterFirst)
  })

  it('throws when there is no history for the file', () => {
    const content = 'We utilize a robust platform every day for our whole growing team here.\n'
    const { dir, file } = makeTrackedRepo('doc.md', content)
    dirs.push(dir)
    const historyDir = join(dir, '.voxfold', 'history')
    mkdirSync(historyDir, { recursive: true })

    expect(() => undoLast(file, historyDir)).toThrow(WriteError)
  })
})
