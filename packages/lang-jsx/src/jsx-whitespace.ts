/**
 * React's own JSX whitespace algorithm, replicated with source-offset tracking.
 *
 * `@babel/types` ships `cleanJSXElementLiteralChild`, which is the actual function React's
 * compiler-adjacent tooling uses to turn `JSXText` into the string a component receives at
 * runtime — but it only returns the cleaned string, not a mapping back to where each character of
 * that string came from in the source. Voxfold needs the mapping (to report accurate flag
 * positions and, later, to write edits back), so this is the same algorithm — same splitting,
 * same per-line trimming, same rule for when a line contributes a trailing space — walked in
 * lockstep with an output offset array. `test/jsx-whitespace.test.ts` checks this against actual
 * `cleanJSXElementLiteralChild` output on a battery of inputs so the two can never quietly drift.
 *
 * Algorithm (mirrors @babel/types/src/utils/react/cleanJSXElementLiteralChild.ts exactly):
 * 1. Split the raw text on line breaks (\r\n, \n, \r), keeping every line including empty ones.
 * 2. Find the last line index that has non-whitespace content.
 * 3. For each line: tabs become spaces; if not the first line, strip leading spaces; if not the
 *    last line, strip trailing spaces.
 * 4. A line that is empty after trimming contributes nothing. A non-empty line contributes its
 *    trimmed text, plus one trailing space UNLESS it is the last non-empty line.
 */

export interface JsxWhitespaceResult {
  text: string
  /** Source offset (relative to the JSXText node's own start) of each output character. */
  offsets: Int32Array
}

/** Split `value` into lines the same way `String.split(/\r\n|\n|\r/)` does, keeping offsets. */
function splitLines(value: string): Array<{ text: string; start: number }> {
  const lines: Array<{ text: string; start: number }> = []
  let lineStart = 0
  let i = 0
  while (i <= value.length) {
    if (i === value.length) {
      lines.push({ text: value.slice(lineStart, i), start: lineStart })
      break
    }
    const char = value[i]
    if (char === '\r' && value[i + 1] === '\n') {
      lines.push({ text: value.slice(lineStart, i), start: lineStart })
      i += 2
      lineStart = i
      continue
    }
    if (char === '\n' || char === '\r') {
      lines.push({ text: value.slice(lineStart, i), start: lineStart })
      i += 1
      lineStart = i
      continue
    }
    i++
  }
  return lines
}

/**
 * @param value The decoded JSXText value (Babel decodes HTML entities before this ever runs).
 * @param inputOffsets When `value` itself is not a direct slice of the source — because it went
 *   through an entity-decoding pass first — the source offset of each character of `value`.
 *   Omit when `value` IS a direct source slice (offsets are then the identity).
 */
export function cleanJsxTextWithOffsets(
  value: string,
  inputOffsets?: Int32Array,
): JsxWhitespaceResult {
  const at = (i: number): number => inputOffsets?.[i] ?? i
  const lines = splitLines(value)

  let lastNonEmptyLine = 0
  for (let i = 0; i < lines.length; i++) {
    if (/[^ \t]/.exec(lines[i]!.text)) lastNonEmptyLine = i
  }

  let text = ''
  const offsets: number[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const isFirstLine = i === 0
    const isLastLine = i === lines.length - 1
    const isLastNonEmptyLine = i === lastNonEmptyLine

    // Babel's own order: convert tabs to spaces FIRST, then strip leading/trailing spaces on the
    // already-converted line — a trailing tab is a trailing space by the time the strip runs, and
    // must be stripped too. Walking character by character (rather than String#replace on the
    // whole line) keeps every surviving character's own source offset; a converted tab still
    // points at the source offset of the original tab character.
    const converted = line.text.replace(/\t/g, ' ')

    let leadStripEnd = 0
    if (!isFirstLine) {
      while (leadStripEnd < converted.length && converted[leadStripEnd] === ' ') leadStripEnd++
    }
    let trailStripStart = converted.length
    if (!isLastLine) {
      while (trailStripStart > leadStripEnd && converted[trailStripStart - 1] === ' ')
        trailStripStart--
    }

    let lineOut = ''
    const lineOffsets: number[] = []
    for (let j = leadStripEnd; j < trailStripStart; j++) {
      lineOut += converted[j]
      lineOffsets.push(at(line.start + j))
    }

    if (lineOut.length > 0) {
      if (!isLastNonEmptyLine) {
        lineOut += ' '
        // The synthesized trailing space has no single source character of its own; point it at
        // the offset one past the last real character on this line, matching how a text-only
        // insertion is conventionally anchored (see `toSourceEdit` in core for the same choice).
        lineOffsets.push(at(line.start + trailStripStart))
      }
      text += lineOut
      offsets.push(...lineOffsets)
    }
  }

  return { text, offsets: Int32Array.from(offsets) }
}
