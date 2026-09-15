/**
 * Fault injection for the Vue writer — same intent as fault-injection-jsx.test.ts, applied to a
 * format whose NodeRefs and offset math are entirely different: structural paths through
 * `@vue/compiler-sfc`'s template AST, whole-file-relative offsets, and template text that is both
 * HTML-entity-decoded AND whitespace-collapsed by the parser. Each of those is a place a bug could
 * silently corrupt a file; this proves the protocol refuses instead.
 */

import { readFileSync } from 'node:fs'
import type { AdapterWriter, LanguageAdapter } from '@voxfold/core'
import { vueAdapter } from '@voxfold/lang-vue'
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
  const { dir, file } = makeTrackedRepo('Component.vue', content)
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

describe('fault injection (Vue): locate() reports the wrong offsets', () => {
  it('catches valueRange.end reported past the real end of the node', () => {
    const content =
      '<template>\n  <p>We utilize a robust platform every day for our whole team.</p>\n</template>\n'
    const { file, dir } = setup(content)
    const document = extractSync(vueAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(vueAdapter, {
      locate: (ast, r) => {
        const real = vueAdapter.writer!.locate(ast, r)
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
      '<template>\n  <div><p>An unrelated leading paragraph with plenty of its own words.</p>' +
      '<p>We utilize a robust platform every day for our whole team.</p></div>\n</template>\n'
    const { file, dir } = setup(content)
    const document = extractSync(vueAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(vueAdapter, {
      locate: (ast, r) => {
        const real = vueAdapter.writer!.locate(ast, r)
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
    const content =
      '<template>\n  <p>We utilize a robust platform every day for our whole team.</p>\n</template>\n'
    const { file, dir } = setup(content)
    const document = extractSync(vueAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(vueAdapter, {
      locate: (ast, r) => {
        const real = vueAdapter.writer!.locate(ast, r)
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
    const content =
      '<template>\n  <p>We utilize a robust platform every day for our whole team.</p>\n</template>\n'
    const { file, dir } = setup(content)
    const document = extractSync(vueAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(vueAdapter, {
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

describe('fault injection (Vue): encode() is careless about escaping', () => {
  it('catches an encoder that leaves template-special characters unescaped', () => {
    const content =
      '<template>\n  <p>We utilize a robust platform every day for our whole team.</p>\n</template>\n'
    const { file, dir } = setup(content)
    const document = extractSync(vueAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(vueAdapter, {
      // A careless encoder that passes text through unescaped, unlike the real one.
      encode: (text) => text,
    })

    // An unescaped `{{` in template text position starts a new interpolation once re-parsed —
    // real structural damage, not just a cosmetic difference.
    expectRefusal(
      () =>
        applyEditRequest(
          {
            file,
            adapter: faulty,
            expectedFileHash: sha256(content),
            targets: [{ ref, expectedOldText: oldText, newText: 'use {{ evil }}' }],
          },
          { projectRoot: dir },
        ),
      ['UnexpectedChange', 'TargetMismatch', 'ReparseFailed'],
    )
    expect(readFileSync(file, 'utf8')).toBe(content)
  })
})

describe('fault injection (Vue): fingerprint() is too loose', () => {
  it('other checks still catch a bad write even when fingerprint always reports "unchanged"', () => {
    const content =
      '<template>\n  <p>We utilize a robust platform every day for our whole team.</p>\n</template>\n'
    const { file, dir } = setup(content)
    const document = extractSync(vueAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const faulty = withFaultyWriter(vueAdapter, {
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
            targets: [{ ref, expectedOldText: oldText, newText: 'use {{ evil }}' }],
          },
          { projectRoot: dir },
        ),
      ['UnexpectedChange', 'TargetMismatch', 'ReparseFailed'],
    )
    expect(readFileSync(file, 'utf8')).toBe(content)
  })
})
