/**
 * Fault injection for the Markdown/MDX writer — same intent as fault-injection-svelte.test.ts,
 * applied to a format whose text-node values can be NARROWER than their raw source span (markdown
 * escapes: `\*` is two source characters for one decoded one) rather than wider or entity-based.
 * A real bug of exactly this shape was caught while wiring this writer up for M11 (see
 * `../src/writer/index.ts`'s `locate()` doc comment) — this suite guards against it regressing.
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
  const { dir, file } = makeTrackedRepo('README.md', content)
  dirs.push(dir)
  return { dir, file }
}

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

const CONTENT = 'We utilize a robust platform every day for our whole team.\n'

describe('fault injection (Markdown): locate() reports the wrong offsets', () => {
  it('catches valueRange.end reported past the real end of the node', () => {
    const { file, dir } = setup(CONTENT)
    const document = extractSync(markdownAdapter, CONTENT, { uri: file })
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
            expectedFileHash: sha256(CONTENT),
            targets: [{ ref, expectedOldText: oldText, newText: 'use' }],
          },
          { projectRoot: dir },
        ),
      ['TargetMismatch', 'OutOfBounds', 'UnexpectedChange', 'ReparseFailed'],
    )
    expect(readFileSync(file, 'utf8')).toBe(CONTENT)
  })

  it('catches a charMap dropped for a node whose raw source actually contains an escape', () => {
    // A real bug caught during M11: locate() previously never built a charMap at all, so any
    // text node whose raw source contains `\*`/`\_`/etc. silently reported a linear range wider
    // than its decoded value — the protocol's own width check (Step 4) catches this class of bug
    // directly, without needing to inject a fault; this test simulates a REGRESSION back to that
    // buggy behavior via an override, so it keeps failing loudly if the fix is ever reverted.
    const content =
      'An unrelated leading paragraph with plenty of its own words.\n\n' +
      'Tom \\* Jerry utilize a robust platform every day for our whole team.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(markdownAdapter, {
      locate: (ast, r) => {
        const real = markdownAdapter.writer!.locate(ast, r)
        // Regression simulation: drop the real charMap, same as the pre-fix code always did.
        const { charMap: _dropped, ...withoutCharMap } = real
        return withoutCharMap
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

  it('catches a decoded value that silently disagrees with the real source text', () => {
    const { file, dir } = setup(CONTENT)
    const document = extractSync(markdownAdapter, CONTENT, { uri: file })
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
            expectedFileHash: sha256(CONTENT),
            targets: [{ ref, expectedOldText: oldText, newText: 'use' }],
          },
          { projectRoot: dir },
        ),
      ['TargetMismatch'],
    )
    expect(readFileSync(file, 'utf8')).toBe(CONTENT)
  })

  it('catches locate() throwing (a broken structural-path resolver)', () => {
    const { file, dir } = setup(CONTENT)
    const document = extractSync(markdownAdapter, CONTENT, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(markdownAdapter, {
      locate: () => {
        throw new Error('simulated: node resolution failed')
      },
    })

    expectRefusal(
      () =>
        applyEditRequest(
          {
            file,
            adapter: faulty,
            expectedFileHash: sha256(CONTENT),
            targets: [{ ref, expectedOldText: oldText, newText: 'use' }],
          },
          { projectRoot: dir },
        ),
      ['TargetMismatch'],
    )
    expect(readFileSync(file, 'utf8')).toBe(CONTENT)
  })
})

describe('fault injection (Markdown): encode() is careless about escaping', () => {
  it('catches an encoder that leaves emphasis-special characters unescaped', () => {
    const { file, dir } = setup(CONTENT)
    const document = extractSync(markdownAdapter, CONTENT, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(markdownAdapter, {
      // A careless encoder that passes text through unescaped, unlike the real one.
      encode: (text) => text,
    })

    // An unescaped `*` pair in text position starts emphasis once re-parsed — real structural
    // damage (the flat block text gains an `emphasis` child, changing the fingerprint), not just
    // a cosmetic difference.
    expectRefusal(
      () =>
        applyEditRequest(
          {
            file,
            adapter: faulty,
            expectedFileHash: sha256(CONTENT),
            targets: [{ ref, expectedOldText: oldText, newText: 'use *emphasis* here' }],
          },
          { projectRoot: dir },
        ),
      ['UnexpectedChange', 'TargetMismatch', 'ReparseFailed'],
    )
    expect(readFileSync(file, 'utf8')).toBe(CONTENT)
  })

  it('catches an encoder that leaves a leading "#" unescaped, turning text into a heading', () => {
    const content = 'Plain text starts a paragraph right here today.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(
      document,
      'Plain text starts a paragraph right here today.',
    )

    const faulty = withFaultyWriter(markdownAdapter, {
      encode: (text) => text,
    })

    expectRefusal(
      () =>
        applyEditRequest(
          {
            file,
            adapter: faulty,
            expectedFileHash: sha256(content),
            targets: [{ ref, expectedOldText: oldText, newText: '# Now a heading, oops.' }],
          },
          { projectRoot: dir },
        ),
      ['UnexpectedChange', 'TargetMismatch', 'ReparseFailed'],
    )
    expect(readFileSync(file, 'utf8')).toBe(content)
  })
})

describe('fault injection (Markdown): fingerprint() is too loose', () => {
  it('other checks still catch a bad write even when fingerprint always reports "unchanged"', () => {
    const { file, dir } = setup(CONTENT)
    const document = extractSync(markdownAdapter, CONTENT, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(markdownAdapter, {
      fingerprint: () => 'always-the-same',
      encode: (text) => text,
    })

    expectRefusal(
      () =>
        applyEditRequest(
          {
            file,
            adapter: faulty,
            expectedFileHash: sha256(CONTENT),
            targets: [{ ref, expectedOldText: oldText, newText: 'use *emphasis* here' }],
          },
          { projectRoot: dir },
        ),
      ['UnexpectedChange', 'TargetMismatch', 'ReparseFailed'],
    )
    expect(readFileSync(file, 'utf8')).toBe(CONTENT)
  })
})
