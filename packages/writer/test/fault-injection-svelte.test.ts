/**
 * Fault injection for the Svelte writer — same intent as fault-injection-vue.test.ts, applied to
 * a format whose NodeRefs and offset math differ again: structural paths through
 * `svelte/compiler`'s modern AST, whole-file-relative offsets (no separate <template> coordinate
 * space to get wrong, unlike Vue), and template text that is HTML-entity-decoded but NOT
 * whitespace-collapsed (unlike Vue). Each of those is a place a bug could silently corrupt a
 * file; this proves the protocol refuses instead.
 */

import { readFileSync } from 'node:fs'
import type { AdapterWriter, LanguageAdapter } from '@voxfold/core'
import { svelteAdapter } from '@voxfold/lang-svelte'
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
  const { dir, file } = makeTrackedRepo('Component.svelte', content)
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

describe('fault injection (Svelte): locate() reports the wrong offsets', () => {
  it('catches valueRange.end reported past the real end of the node', () => {
    const content = '<p>We utilize a robust platform every day for our whole team.</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(svelteAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(svelteAdapter, {
      locate: (ast, r) => {
        const real = svelteAdapter.writer!.locate(ast, r)
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

  it('catches a charMap entry that points outside its own valueRange', () => {
    const content =
      '<div><p>An unrelated leading paragraph with plenty of its own words.</p>' +
      '<p>We utilize a robust platform every day for our whole team.</p></div>\n'
    const { file, dir } = setup(content)
    const document = extractSync(svelteAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(svelteAdapter, {
      locate: (ast, r) => {
        const real = svelteAdapter.writer!.locate(ast, r)
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

  it('catches a decoded value that silently disagrees with the real source text', () => {
    const content = '<p>We utilize a robust platform every day for our whole team.</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(svelteAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(svelteAdapter, {
      locate: (ast, r) => {
        const real = svelteAdapter.writer!.locate(ast, r)
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

  it('catches locate() throwing (a broken structural-path resolver)', () => {
    const content = '<p>We utilize a robust platform every day for our whole team.</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(svelteAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(svelteAdapter, {
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
            expectedFileHash: sha256(content),
            targets: [{ ref, expectedOldText: oldText, newText: 'use' }],
          },
          { projectRoot: dir },
        ),
      ['TargetMismatch'],
    )
    expect(readFileSync(file, 'utf8')).toBe(content)
  })
})

describe('fault injection (Svelte): encode() is careless about escaping', () => {
  it('catches an encoder that leaves template-special characters unescaped', () => {
    const content = '<p>We utilize a robust platform every day for our whole team.</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(svelteAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(svelteAdapter, {
      // A careless encoder that passes text through unescaped, unlike the real one.
      encode: (text) => text,
    })

    // An unescaped `{` in template text position starts a new ExpressionTag once re-parsed —
    // real structural damage, not just a cosmetic difference.
    expectRefusal(
      () =>
        applyEditRequest(
          {
            file,
            adapter: faulty,
            expectedFileHash: sha256(content),
            targets: [{ ref, expectedOldText: oldText, newText: 'use {evil}' }],
          },
          { projectRoot: dir },
        ),
      ['UnexpectedChange', 'TargetMismatch', 'ReparseFailed'],
    )
    expect(readFileSync(file, 'utf8')).toBe(content)
  })
})

describe('fault injection (Svelte): fingerprint() is too loose', () => {
  it('other checks still catch a bad write even when fingerprint always reports "unchanged"', () => {
    const content = '<p>We utilize a robust platform every day for our whole team.</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(svelteAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(svelteAdapter, {
      fingerprint: () => 'always-the-same',
      encode: (text) => text,
    })

    expectRefusal(
      () =>
        applyEditRequest(
          {
            file,
            adapter: faulty,
            expectedFileHash: sha256(content),
            targets: [{ ref, expectedOldText: oldText, newText: 'use {evil}' }],
          },
          { projectRoot: dir },
        ),
      ['UnexpectedChange', 'TargetMismatch', 'ReparseFailed'],
    )
    expect(readFileSync(file, 'utf8')).toBe(content)
  })
})
