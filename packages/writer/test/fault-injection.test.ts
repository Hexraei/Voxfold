/**
 * Fault injection: deliberately break an adapter's `locate`/`encode` in specific, targeted ways
 * and prove the protocol refuses every one of them rather than writing a corrupted file.
 *
 * This is the test that proves the safety net itself works — every other test in this package
 * proves the happy path is correct, but only this file proves that when an adapter's writer hooks
 * are wrong (an off-by-one offset, a dropped escape, a charMap that lies), the protocol notices
 * and refuses instead of silently writing bad bytes. A protocol that passes every happy-path test
 * but has no fault-injection coverage has never actually been tested for the one thing it exists
 * to prevent.
 */

import { readFileSync } from 'node:fs'
import type { AdapterWriter, LanguageAdapter } from '@voxfold/core'
import { markdownAdapter } from '@voxfold/lang-markdown'
import { afterEach, describe, expect, it } from 'vitest'
import { WriteError } from '../src/errors.ts'
import { sha256 } from '../src/hash.ts'
import { applyEditRequest } from '../src/protocol.ts'
import { cleanup, extractSync, findSegment, makeTrackedRepo } from './helpers.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) cleanup(dir)
})

function setup(content: string) {
  const { dir, file } = makeTrackedRepo('doc.md', content)
  dirs.push(dir)
  return { dir, file }
}

/** Wrap an adapter's writer, replacing one hook with a faulty version. */
function withFaultyWriter(
  adapter: LanguageAdapter,
  overrides: Partial<AdapterWriter>,
): LanguageAdapter {
  return { ...adapter, writer: { ...adapter.writer!, ...overrides } }
}

function expectRefusal(run: () => void, codes: string[]) {
  try {
    run()
    expect.unreachable('expected the write to be refused')
  } catch (error) {
    expect(error).toBeInstanceOf(WriteError)
    expect(codes).toContain((error as WriteError).code)
  }
}

describe('fault injection: locate() reports the wrong offsets', () => {
  it('catches an off-by-one on valueRange.start (shifted left)', () => {
    const content = 'We utilize a robust platform every day for our whole growing team here.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(markdownAdapter, {
      locate: (ast, r) => {
        const real = markdownAdapter.writer!.locate(ast, r)
        return {
          ...real,
          valueRange: { start: real.valueRange.start - 1, end: real.valueRange.end },
        }
      },
    })

    expectRefusal(
      () =>
        applyEditRequest(
          {
            file,
            adapter: faulty,
            expectedFileHash: sha256(content),
            targets: [{ ref, expectedOldText: oldText, newText: 'use' }],
          },
          { projectRoot: dir },
        ),
      // Shifting the start left one byte means `decoded` (still read from the true node) no
      // longer matches what a correct valueRange would slice, OR the shifted range now includes
      // one byte of the preceding word — either is a real corruption this must catch.
      ['TargetMismatch', 'OutOfBounds', 'UnexpectedChange', 'ReparseFailed'],
    )

    expect(readFileSync(file, 'utf8')).toBe(content)
  })

  it('catches valueRange.end reported past the real end of the node', () => {
    const content = 'We utilize a robust platform every day for our whole growing team here.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(markdownAdapter, {
      locate: (ast, r) => {
        const real = markdownAdapter.writer!.locate(ast, r)
        return {
          ...real,
          valueRange: { start: real.valueRange.start, end: real.valueRange.end + 5 },
        }
      },
    })

    expectRefusal(
      () =>
        applyEditRequest(
          {
            file,
            adapter: faulty,
            expectedFileHash: sha256(content),
            targets: [{ ref, expectedOldText: oldText, newText: 'use' }],
          },
          { projectRoot: dir },
        ),
      ['TargetMismatch', 'OutOfBounds', 'UnexpectedChange', 'ReparseFailed'],
    )

    expect(readFileSync(file, 'utf8')).toBe(content)
  })

  it('catches a decoded value that silently disagrees with the real source text', () => {
    const content = 'We utilize a robust platform every day for our whole growing team here.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(markdownAdapter, {
      locate: (ast, r) => {
        const real = markdownAdapter.writer!.locate(ast, r)
        return { ...real, decoded: `${real.decoded}x` }
      },
    })

    expectRefusal(
      () =>
        applyEditRequest(
          {
            file,
            adapter: faulty,
            expectedFileHash: sha256(content),
            targets: [{ ref, expectedOldText: oldText, newText: 'use' }],
          },
          { projectRoot: dir },
        ),
      ['TargetMismatch'],
    )

    expect(readFileSync(file, 'utf8')).toBe(content)
  })

  it('catches a charMap entry that points outside its own valueRange', () => {
    // Leading content pushes the target sentence's valueRange.start well past source offset 0, so
    // a corrupted entry pointing at an earlier, unrelated offset cannot be mistaken for a
    // legitimate one (a target starting exactly at offset 0 would make a corrupted "0" entry
    // indistinguishable from that segment's own real start — the earlier version of this test had
    // exactly that blind spot).
    const content =
      'Some unrelated leading paragraph with plenty of its own words before the target.\n\n' +
      'We utilize a robust platform every day for our whole growing team here.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(markdownAdapter, {
      locate: (ast, r) => {
        const real = markdownAdapter.writer!.locate(ast, r)
        // One entry (not the first or last, so it's genuinely "dropped" mid-range rather than an
        // edge case) redirected to source offset 0 — outside this node's own valueRange, since
        // the node starts well after the leading paragraph.
        const dropped = Math.floor(real.decoded.length / 2)
        const charMap = Int32Array.from(
          Array.from({ length: real.decoded.length }, (_, i) =>
            i === dropped ? 0 : real.valueRange.start + i,
          ),
        )
        return { ...real, charMap }
      },
    })

    expectRefusal(
      () =>
        applyEditRequest(
          {
            file,
            adapter: faulty,
            expectedFileHash: sha256(content),
            targets: [{ ref, expectedOldText: oldText, newText: 'use' }],
          },
          { projectRoot: dir },
        ),
      ['OutOfBounds', 'UnexpectedChange', 'ReparseFailed', 'TargetMismatch'],
    )

    expect(readFileSync(file, 'utf8')).toBe(content)
  })
})

describe('fault injection: encode() is careless about escaping', () => {
  it('catches an encoder that leaves markdown-special characters unescaped', () => {
    const content = 'We utilize a robust platform every day for our whole growing team here.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(markdownAdapter, {
      // A careless encoder that passes text through unescaped, unlike the real one.
      encode: (text) => text,
    })

    // "*use*" written unescaped is no longer plain text once re-parsed: markdown reads it as an
    // emphasis span containing "use", not a text node reading "*use*". The real adapter's
    // `locate` returns a node's own decoded value, so after the (unescaped) write, the target
    // path either no longer points at a plain text node, or that node's value is "use" rather
    // than the intended "*use*" — either way the protocol must refuse, not silently accept a
    // write that changed the document's structure.
    expectRefusal(
      () =>
        applyEditRequest(
          {
            file,
            adapter: faulty,
            expectedFileHash: sha256(content),
            targets: [{ ref, expectedOldText: oldText, newText: '*use*' }],
          },
          { projectRoot: dir },
        ),
      ['UnexpectedChange', 'TargetMismatch', 'ReparseFailed'],
    )

    expect(readFileSync(file, 'utf8')).toBe(content)
  })
})

describe('fault injection: fingerprint() is too loose', () => {
  it('other checks still catch a bad write even when fingerprint always reports "unchanged"', () => {
    const content = 'We utilize a robust platform every day for our whole growing team here.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(markdownAdapter, {
      // A fingerprint that reports no structural change no matter what, defeating step 9's
      // structure check entirely on its own.
      fingerprint: () => 'always-the-same',
      // Paired with an encoder that introduces real markdown structure (as above), so if
      // fingerprint were the ONLY thing standing between this and a bad write, it would succeed.
      encode: (text) => text,
    })

    expectRefusal(
      () =>
        applyEditRequest(
          {
            file,
            adapter: faulty,
            expectedFileHash: sha256(content),
            targets: [{ ref, expectedOldText: oldText, newText: '*use*' }],
          },
          { projectRoot: dir },
        ),
      // Step 9's per-target readback check ("does this path still hold the intended text?")
      // catches it independently of fingerprint, proving the protocol does not rely on any
      // single check.
      ['UnexpectedChange', 'TargetMismatch', 'ReparseFailed'],
    )

    expect(readFileSync(file, 'utf8')).toBe(content)
  })
})
