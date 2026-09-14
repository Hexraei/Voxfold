/**
 * Differential test: `cleanJsxTextWithOffsets` must produce the same TEXT as Babel's own
 * `cleanJSXElementLiteralChild` for every input, and every offset it reports must point at the
 * correct source character. If this drifts from Babel's real algorithm, Voxfold would report
 * flags at the wrong position in a JSX file and, later, write edits to the wrong place.
 */

import { jsxText } from '@babel/types'
// Not part of @babel/types' public export surface, but this is exactly the internal function
// React tooling uses to turn JSXText into a runtime string — the one thing worth pinning a
// differential test against, even via a deep import, since a public re-implementation could
// silently drift from Babel's real, load-bearing behavior otherwise.
// @ts-expect-error -- deep import has no published type declaration
import cleanJSXElementLiteralChild from '@babel/types/lib/utils/react/cleanJSXElementLiteralChild.js'
import { describe, expect, it } from 'vitest'
import { cleanJsxTextWithOffsets } from '../src/jsx-whitespace.ts'

/** What Babel itself would produce for this JSXText value, or undefined if it drops the child. */
function babelClean(value: string): string | undefined {
  const args: Array<{ value?: unknown }> = []
  cleanJSXElementLiteralChild(jsxText(value), args)
  return args.length > 0 ? (args[0] as { value: string }).value : undefined
}

function check(raw: string) {
  const result = cleanJsxTextWithOffsets(raw)
  const expected = babelClean(raw)
  expect(result.text).toBe(expected ?? '')

  // Every offset must be non-decreasing (output reads left-to-right through the source) and, for
  // every character that isn't a synthesized joining space, must point at the exact source
  // character it came from (a tab in the source surfaces as a space in the output).
  expect(result.offsets.length).toBe(result.text.length)
  for (let i = 1; i < result.offsets.length; i++) {
    expect(result.offsets[i]!).toBeGreaterThanOrEqual(result.offsets[i - 1]!)
  }
  for (let i = 0; i < result.text.length; i++) {
    const offset = result.offsets[i]!
    const sourceChar = raw[offset]
    const isDirectMatch =
      sourceChar === result.text[i] || (sourceChar === '\t' && result.text[i] === ' ')
    const isSynthesizedSpace = result.text[i] === ' ' && !isDirectMatch
    expect(isDirectMatch || isSynthesizedSpace).toBe(true)
  }
}

describe('cleanJsxTextWithOffsets matches @babel/types exactly', () => {
  it('single line, no leading/trailing whitespace', () => check('hello world'))
  it('single line with leading and trailing spaces (both preserved: only line)', () =>
    check('  hello world  '))
  it('two lines joined by a newline, both with indentation', () => check('  hello\n  world  '))
  it('three lines, middle blank', () => check('  hello\n\n  world  '))
  it('leading blank line then content', () => check('\n  hello  '))
  it('trailing blank line after content', () => check('  hello  \n'))
  it('tabs used as indentation', () => check('\thello\n\tworld\t'))
  it('CRLF line endings', () => check('  hello\r\n  world  '))
  it('lone CR line endings', () => check('  hello\r  world  '))
  it('only whitespace, no real content', () => check('   \n   \n   '))
  it('empty string', () => check(''))
  it('a single space', () => check(' '))
  it('mixed tabs and spaces indentation', () => check(' \t hello \t \n \t world \t '))
  it('many blank lines between two words', () => check('first\n\n\n\n\nlast'))
  it('unicode content with surrounding whitespace', () => check('  café — 世界  '))
})
