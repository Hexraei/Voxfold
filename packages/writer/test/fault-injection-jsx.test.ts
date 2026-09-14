/**
 * Fault injection for the JSX writer — same intent as fault-injection.test.ts, applied to a
 * format whose NodeRefs and offset math are entirely different from markdown/HTML (structural
 * paths through a Babel AST, JSX's own whitespace algorithm, HTML-entity decoding inside JSXText,
 * and JS-string-literal escape decoding for `{"..."}` children). Each of those is a place a bug
 * could silently corrupt a file; this proves the protocol refuses instead.
 */

import { readFileSync } from 'node:fs'
import type { AdapterWriter, LanguageAdapter } from '@voxfold/core'
import { jsxAdapter } from '@voxfold/lang-jsx'
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
  const { dir, file } = makeTrackedRepo('Component.tsx', content)
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

describe('fault injection (JSX): locate() reports the wrong offsets', () => {
  it('catches valueRange.end reported past the real end of the node', () => {
    const content = 'const x = <p>We utilize a robust platform every day for our whole team.</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(jsxAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(jsxAdapter, {
      locate: (ast, r) => {
        const real = jsxAdapter.writer!.locate(ast, r)
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
      'const x = <div><p>An unrelated leading paragraph with plenty of its own words.</p>' +
      '<p>We utilize a robust platform every day for our whole team.</p></div>\n'
    const { file, dir } = setup(content)
    const document = extractSync(jsxAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(jsxAdapter, {
      locate: (ast, r) => {
        const real = jsxAdapter.writer!.locate(ast, r)
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
    const content = 'const x = <p>We utilize a robust platform every day for our whole team.</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(jsxAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(jsxAdapter, {
      locate: (ast, r) => {
        const real = jsxAdapter.writer!.locate(ast, r)
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
    const content = 'const x = <p>We utilize a robust platform every day for our whole team.</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(jsxAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(jsxAdapter, {
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

describe('fault injection (JSX): encode() is careless about escaping', () => {
  it('catches an encoder that leaves JSX-special characters unescaped', () => {
    const content = 'const x = <p>We utilize a robust platform every day for our whole team.</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(jsxAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(jsxAdapter, {
      // A careless encoder that passes text through unescaped, unlike the real one.
      encode: (text) => text,
    })

    // An unescaped `{` in JSXText position starts a new expression container once re-parsed —
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

describe('fault injection (JSX): fingerprint() is too loose', () => {
  it('other checks still catch a bad write even when fingerprint always reports "unchanged"', () => {
    const content = 'const x = <p>We utilize a robust platform every day for our whole team.</p>\n'
    const { file, dir } = setup(content)
    const document = extractSync(jsxAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(jsxAdapter, {
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
