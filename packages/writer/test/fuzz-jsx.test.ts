/**
 * Same invariant as fuzz.test.ts and fuzz-html.test.ts, against the JSX adapter: a write either
 * succeeds and reads back exactly, or is cleanly refused — never a corrupted file.
 */

import { readFileSync } from 'node:fs'
import { jsxAdapter } from '@voxfold/lang-jsx'
import fc from 'fast-check'
import { afterAll, describe, expect, it } from 'vitest'
import { isWriteError } from '../src/errors.ts'
import { sha256 } from '../src/hash.ts'
import { applyEditRequest } from '../src/protocol.ts'
import { cleanup, extractSync, findSegment, makeTrackedRepo, resetTrackedFile } from './helpers.ts'

// Keep all 2,000 real-write checks on Windows despite slower Git process startup.
const fuzzTimeout = process.platform === 'win32' ? 600_000 : 60_000

// Includes JSX's own special characters (`{`, `}`, `<`, `>`, `&`) alongside the general set, since
// those are exactly what a careless encoder in this adapter could get wrong.
const WORD_POOL = ['the', 'team', 'platform', 'utilize', 'robust', 'quickly', 'data', 'every']
const SPECIAL_CHARS = ['{', '}', '<', '>', '&', '*', '_', '`', '|', '#', '\\', '"', "'"]
const wordArb = fc.constantFrom(...WORD_POOL)
const specialArb = fc.constantFrom(...SPECIAL_CHARS)
const emojiArb = fc.constantFrom('🚀', '✨', '👍', '🎉')

const replacementArb = fc
  .array(
    fc.oneof(
      { weight: 5, arbitrary: wordArb },
      { weight: 2, arbitrary: specialArb },
      { weight: 1, arbitrary: emojiArb },
    ),
    { minLength: 1, maxLength: 6 },
  )
  .map((parts) => parts.join(' '))

describe('fuzz: random edits never corrupt a JSX file', () => {
  const content =
    'const x = (\n' +
    '  <div>\n' +
    '    <p>Some unrelated leading paragraph with plenty of its own words.</p>\n' +
    '    <p>We utilize a robust platform every day for our whole growing team here.</p>\n' +
    '  </div>\n' +
    ')\n'
  const { dir, file } = makeTrackedRepo('Component.tsx', content)
  afterAll(() => cleanup(dir))

  it('every write either succeeds and reads back exactly, or is cleanly refused', () => {
    fc.assert(
      fc.property(replacementArb, (replacement) => {
        resetTrackedFile(file, content)

        const targetBlockIndex = 1
        const document = extractSync(jsxAdapter, content, { uri: file })
        const block = document.blocks[targetBlockIndex]!
        const { ref, oldText } = findSegment(document, 'utilize')
        expect(block.text).toContain(oldText)
        const newText = oldText.replace('utilize', replacement)
        const expectedNewBlockText = block.text.replace(oldText, newText)

        let outcome: 'wrote' | 'refused'
        try {
          const result = applyEditRequest(
            {
              file,
              adapter: jsxAdapter,
              expectedFileHash: sha256(content),
              targets: [{ ref, expectedOldText: oldText, newText }],
            },
            { projectRoot: dir },
          )
          outcome = 'wrote'
          expect(readFileSync(file, 'utf8')).toBe(result.newText)
        } catch (error) {
          if (!isWriteError(error)) throw error
          outcome = 'refused'
        }

        if (outcome === 'refused') {
          expect(readFileSync(file, 'utf8')).toBe(content)
          return
        }

        const writtenOnDisk = readFileSync(file, 'utf8')
        const reExtracted = extractSync(jsxAdapter, writtenOnDisk, { uri: file })
        expect(reExtracted.blocks[targetBlockIndex]!.text).toBe(expectedNewBlockText)
      }),
      // 2000 to match this monorepo's other fast-check suites and keep CI fast. Run once by
      // hand at 10,000 iterations with zero failures before scaling back (see the M7 commit).
      { numRuns: 2000 },
    )
  }, fuzzTimeout)
})
