/**
 * Fault injection for the Astro writer — same intent as fault-injection-svelte.test.ts, applied
 * to a format whose offsets are byte-based at the AST layer (converted to UTF-16 by
 * `ByteOffsetMap` before the writer ever sees them — see lang-astro's module doc) and whose
 * `{expr}` node mixes raw JS text with real embedded elements. Each of those is a place a bug
 * could silently corrupt a file; this proves the protocol refuses instead.
 */

import { readFileSync } from 'node:fs'
import type { AdapterWriter, LanguageAdapter, ProseDocument } from '@voxfold/core'
import { astroAdapter } from '@voxfold/lang-astro'
import { afterEach, describe, expect, it } from 'vitest'
import { WriteError } from '../src/errors.ts'
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

async function extractAstro(text: string, uri: string): Promise<ProseDocument> {
  return (await astroAdapter.extract(text, { uri })) as ProseDocument
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

const CONTENT =
  '---\nconst title = "hi"\n---\n<p>We utilize a robust platform every day for our whole team.</p>\n'

describe('fault injection (Astro): locate() reports the wrong offsets', () => {
  it('catches valueRange.end reported past the real end of the node', async () => {
    const { file, dir } = setup(CONTENT)
    const document = await extractAstro(CONTENT, file)
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(astroAdapter, {
      locate: (ast, r) => {
        const real = astroAdapter.writer!.locate(ast, r)
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

  it('catches a charMap entry that points outside its own valueRange', async () => {
    const content =
      '---\nconst title = "hi"\n---\n<div><p>An unrelated leading paragraph with plenty of its own words.</p>' +
      '<p>We utilize a robust platform every day for our whole team.</p></div>\n'
    const { file, dir } = setup(content)
    const document = await extractAstro(content, file)
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(astroAdapter, {
      locate: (ast, r) => {
        const real = astroAdapter.writer!.locate(ast, r)
        const dropped = Math.floor(real.decoded.length / 2)
        const base =
          real.charMap ??
          Int32Array.from({ length: real.decoded.length }, (_, i) => real.valueRange.start + i)
        const charMap = Int32Array.from(base)
        charMap[dropped] = 0
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

  it('catches a decoded value that silently disagrees with the real source text', async () => {
    const { file, dir } = setup(CONTENT)
    const document = await extractAstro(CONTENT, file)
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(astroAdapter, {
      locate: (ast, r) => {
        const real = astroAdapter.writer!.locate(ast, r)
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

  it('catches locate() throwing (a broken structural-path resolver)', async () => {
    const { file, dir } = setup(CONTENT)
    const document = await extractAstro(CONTENT, file)
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(astroAdapter, {
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

describe('fault injection (Astro): encode() is careless about escaping', () => {
  it('catches an encoder that leaves template-special characters unescaped', async () => {
    const { file, dir } = setup(CONTENT)
    const document = await extractAstro(CONTENT, file)
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(astroAdapter, {
      // A careless encoder that passes text through unescaped, unlike the real one.
      encode: (text) => text,
    })

    // An unescaped `{` in template text position starts a new expression node once re-parsed —
    // real structural damage, not just a cosmetic difference (verified empirically in encode.ts).
    expectRefusal(
      () =>
        applyEditRequest(
          {
            file,
            adapter: faulty,
            expectedFileHash: sha256(CONTENT),
            targets: [{ ref, expectedOldText: oldText, newText: 'use {evil}' }],
          },
          { projectRoot: dir },
        ),
      ['UnexpectedChange', 'TargetMismatch', 'ReparseFailed'],
    )
    expect(readFileSync(file, 'utf8')).toBe(CONTENT)
  })
})

describe('fault injection (Astro): fingerprint() is too loose', () => {
  it('other checks still catch a bad write even when fingerprint always reports "unchanged"', async () => {
    const { file, dir } = setup(CONTENT)
    const document = await extractAstro(CONTENT, file)
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(astroAdapter, {
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
            targets: [{ ref, expectedOldText: oldText, newText: 'use {evil}' }],
          },
          { projectRoot: dir },
        ),
      ['UnexpectedChange', 'TargetMismatch', 'ReparseFailed'],
    )
    expect(readFileSync(file, 'utf8')).toBe(CONTENT)
  })
})
