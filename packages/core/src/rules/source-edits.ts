/**
 * Translate a fix/suggestion's flat-block-relative edits into source-file offsets.
 *
 * `planFix` (in fixes.ts) computes edits against a block's flattened text — the same coordinate
 * space `Match.start`/`end` live in. That is never safe to apply directly to the source file:
 * a block is a concatenation of possibly non-contiguous source spans (text split across
 * `<strong>` tags, markdown escapes, collapsed whitespace), so a flat offset and a source offset
 * are only ever equal by coincidence (a single-segment block starting at source offset 0).
 *
 * This module is the one place that bridges the two coordinate spaces for writes, so every
 * caller (the engine's `Flag.fix`, `applyFixes`, the CLI, the future overlay) goes through the
 * same, tested translation instead of each re-deriving it.
 */

import type { OffsetMap } from '../offset-map.ts'
import type { FlatEdit } from './fixes.ts'

/** A fix edit expressed in source-file coordinates, ready to apply to the document's `source`. */
export interface SourceEdit {
  start: number
  end: number
  text: string
}

/**
 * Translate one flat edit to a source edit, or return undefined when it cannot be expressed as a
 * single contiguous source replacement.
 *
 * Refused, not guessed, when:
 *   - any part of the edited range has no source (a DOM-only document, or an inserted boundary)
 *   - any part of the edited range is not editable (spans a placeholder / locked segment)
 *   - the range spans more than one segment AND those segments are not contiguous in the source
 *     (text split across an inline tag: the two source spans are not adjacent, so a single
 *     replacement string cannot represent "replace both, keep what's between them")
 *
 * A fix spanning exactly one segment — the overwhelming majority, since mechanical rules match
 * single words or short phrases — always translates cleanly.
 */
export function toSourceEdit(map: OffsetMap, edit: FlatEdit): SourceEdit | undefined {
  const ranges = map.toSourceRanges(edit.start, edit.end)
  if (ranges.length === 0) return undefined
  if (!ranges.every((range) => range.editable)) return undefined

  if (ranges.length === 1) {
    const range = ranges[0]!
    return { start: range.start, end: range.end, text: edit.text }
  }

  // Multiple segments: only safe when they are back-to-back in the source, i.e. the match
  // crossed a segment boundary (adjacent text nodes) but not an inline tag or placeholder that
  // would leave a gap the replacement text cannot account for.
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i]!.start !== ranges[i - 1]!.end) return undefined
  }
  return { start: ranges[0]!.start, end: ranges[ranges.length - 1]!.end, text: edit.text }
}

/**
 * Translate a full edit list, dropping (never guessing at) any edit that cannot be expressed in
 * source coordinates. Used when downgrading is acceptable (suggestions); `translateFixStrict`
 * is used where a partial translation would be worse than no fix at all.
 */
export function translateEdits(map: OffsetMap, edits: readonly FlatEdit[]): SourceEdit[] {
  const translated: SourceEdit[] = []
  for (const edit of edits) {
    const source = toSourceEdit(map, edit)
    if (source) translated.push(source)
  }
  return translated
}

/**
 * Translate a fix's edit list, refusing the whole fix if any single edit cannot be translated.
 * A fix is meant to apply unattended under `--fix`; a fix that partially failed to translate
 * would silently apply only some of its edits (e.g. the replacement but not the recapitalize),
 * which is exactly the kind of half-applied, source-corrupting result this exists to prevent.
 */
export function translateFixStrict(
  map: OffsetMap,
  edits: readonly FlatEdit[],
): SourceEdit[] | undefined {
  const translated: SourceEdit[] = []
  for (const edit of edits) {
    const source = toSourceEdit(map, edit)
    if (!source) return undefined
    translated.push(source)
  }
  return translated
}
