/**
 * Comparison-only normalization.
 *
 * Rules must match "doesn't" whether the apostrophe is U+0027 or U+2019, and must treat en dash,
 * em dash and horizontal bar as the same tell. The text itself is NEVER rewritten: rewriting
 * would invalidate every offset in the map. Only the comparison key is normalized, and it is
 * always the same length in UTF-16 code units as its input, so an index into the key is an
 * index into the text.
 *
 * Every class below is written with \u escapes on purpose: the literal characters are invisible
 * or indistinguishable in an editor, which makes them unreviewable and easy to typo.
 */

/** Apostrophe-like characters that compare equal to U+0027 ' */
const APOSTROPHES = /[‘’ʼʹ′´`]/g

/** Quote-like characters that compare equal to U+0022 " */
const QUOTES = /[“”„‟″«»]/g

/** Dashes that read as an em dash: en dash, em dash, horizontal bar, minus sign. */
const DASHES = /[–—―−]/g

/** Whitespace that compares equal to a plain space: NBSP, en/em/thin quad, ideographic space. */
const SPACES = /[   -   　]/g

/**
 * Zero-width characters: no meaning for matching, but they still occupy offsets.
 * Written as an alternation, not a character class: U+200D is the zero-width joiner that binds
 * emoji sequences (👩‍💻), and a class containing it silently matches inside a joined sequence.
 */
const INVISIBLES = /‌|‍|﻿/g

/** Single canonical stand-in for every zero-width character (U+200B). */
const ZERO_WIDTH = '​'

/**
 * Lower-case and fold lookalike punctuation for matching.
 *
 * Length is preserved exactly. `toLowerCase` is applied per UTF-16 code unit and skipped when
 * the result is not a single unit, so a character whose lowercase form is longer (U+0130 İ →
 * "i̇", two units) cannot shift subsequent offsets. Cased astral scripts (Deseret, Adlam) are
 * therefore left as-is, which is fine for an English-only rule set. Locale-sensitive APIs are
 * avoided entirely so output never depends on the machine's locale.
 */
export function normalizeForMatch(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    const lower = char.toLowerCase()
    out += lower.length === 1 ? lower : char
  }
  return out
    .replace(APOSTROPHES, "'")
    .replace(QUOTES, '"')
    .replace(DASHES, '—')
    .replace(SPACES, ' ')
    .replace(INVISIBLES, ZERO_WIDTH)
}

/** True when the two strings are equal after comparison normalization. */
export function equalsNormalized(a: string, b: string): boolean {
  return normalizeForMatch(a) === normalizeForMatch(b)
}
