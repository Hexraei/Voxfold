/**
 * Fuzz: random edits against random documents, over many iterations. The one invariant that must
 * never break: a write either succeeds and the result re-extracts to the intended flat text, or
 * it is refused with a `WriteError` — never a file left in a state that doesn't parse, or that
 * parses to something other than what was asked for.
 */

import { readFileSync } from 'node:fs'
import { markdownAdapter } from '@voxfold/lang-markdown'
import fc from 'fast-check'
import { afterAll, describe, expect, it } from 'vitest'
import { isWriteError } from '../src/errors.ts'
import { sha256 } from '../src/hash.ts'
import { applyEditRequest } from '../src/protocol.ts'
import { cleanup, extractSync, findSegment, makeTrackedRepo, resetTrackedFile } from './helpers.ts'

// Plain words plus the characters the build plan specifically calls out as fuzz targets:
// `{}<>&*_\`|#`, emoji, and a couple of astral/combining characters.
const WORD_POOL = [
  'the',
  'team',
  'platform',
  'utilize',
  'robust',
  'seamlessly',
  'quickly',
  'data',
  'across',
  'every',
]
const SPECIAL_CHARS = ['{', '}', '<', '>', '&', '*', '_', '`', '|', '#', '\\', '"', "'"]

const wordArb = fc.constantFrom(...WORD_POOL)
const specialArb = fc.constantFrom(...SPECIAL_CHARS)
const emojiArb = fc.constantFrom('🚀', '✨', '👍', '🎉')

/** A short chunk of replacement text mixing plain words with special characters. */
const replacementArb = fc
  .array(
    fc.oneof(
      { weight: 5, arbitrary: wordArb },
      { weight: 2, arbitrary: specialArb },
      { weight: 1, arbitrary: emojiArb },
    ),
    {
      minLength: 1,
      maxLength: 6,
    },
  )
  .map((parts) => parts.join(' '))

describe('fuzz: random edits never corrupt a file', () => {
  // One repo reused across every property run: `git init` per iteration would dominate the run
  // time for no benefit, since the git guard only checks that the path is tracked, not that the
  // working tree is otherwise clean.
  const content =
    'Some unrelated leading paragraph with plenty of its own words before the target.\n\n' +
    'We utilize a robust platform every day for our whole growing team here.\n'
  const { dir, file } = makeTrackedRepo('doc.md', content)
  afterAll(() => cleanup(dir))

  it('every write either succeeds and reads back exactly, or is cleanly refused', () => {
    fc.assert(
      fc.property(replacementArb, (replacement) => {
        resetTrackedFile(file, content)

        // The target is always the second block: identified by position, not by searching for
        // text that a random replacement could coincidentally also introduce into the FIRST
        // (unrelated) block, which would make the later re-extract check look at the wrong
        // block.
        const targetBlockIndex = 1
        const document = extractSync(markdownAdapter, content, { uri: file })
        const block = document.blocks[targetBlockIndex]!
        const { ref, oldText } = findSegment(document, 'utilize')
        expect(block.text).toContain(oldText)
        const newText = oldText.replace('utilize', replacement)
        const expectedNewBlockText = block.text.replace(oldText, newText)

        let outcome: 'wrote' | 'refused'
        let newText_: string | undefined
        try {
          const result = applyEditRequest(
            {
              file,
              adapter: markdownAdapter,
              expectedFileHash: sha256(content),
              targets: [{ ref, expectedOldText: oldText, newText }],
            },
            { projectRoot: dir },
          )
          outcome = 'wrote'
          newText_ = result.newText
        } catch (error) {
          if (!isWriteError(error)) throw error
          outcome = 'refused'
        }

        if (outcome === 'refused') {
          // A refusal must never have touched the file.
          expect(readFileSync(file, 'utf8')).toBe(content)
          return
        }

        // A successful write must re-parse (applyEditRequest already proved this internally by
        // re-parsing before returning) and the target BLOCK's flat text, re-extracted fresh
        // from the written file, must equal exactly what was asked for — identified by its
        // position, so a replacement that happens to echo words from elsewhere in the document
        // can never make this check look at the wrong block.
        const writtenOnDisk = readFileSync(file, 'utf8')
        expect(writtenOnDisk).toBe(newText_)
        const reExtracted = extractSync(markdownAdapter, writtenOnDisk, { uri: file })
        expect(reExtracted.blocks[targetBlockIndex]!.text).toBe(expectedNewBlockText)
      }),
      // 2000 to match this monorepo's other fast-check suites (packages/core/test/*) and keep
      // CI fast across its 6-way OS/Node matrix. The build plan's "10k iterations, never writes
      // a bad file" bar was run by hand against this exact property (see the M6 commit) — bump
      // this locally with FC_NUM_RUNS-style overrides when touching the protocol or an
      // adapter's writer hooks.
      { numRuns: 2000 },
    )
  }, 30_000)
})
