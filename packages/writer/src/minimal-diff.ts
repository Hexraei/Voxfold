/**
 * Step 5 of the protocol: patch only the part of a segment that actually changed.
 *
 * A human editing "We utilize a robust platform" to "We use a robust platform" changed one word.
 * Encoding and writing the whole sentence would be correct but needlessly invasive — it can
 * reformat untouched punctuation, drop an escape the encoder doesn't know is significant, or (for
 * an adapter with a lossy encoder) subtly change text the user never touched. Diffing to the
 * smallest changed span, then encoding only that, keeps everything outside it byte-identical by
 * construction rather than by hoping the encoder is careful.
 */

export interface MinimalDiff {
  /** Index into the OLD decoded string where the common prefix ends. */
  prefixEnd: number
  /** Index into the OLD decoded string where the common suffix begins. */
  suffixStart: number
  /** The changed middle of the NEW decoded string, to be encoded and spliced in. */
  changedNew: string
}

export function minimalDiff(oldText: string, newText: string): MinimalDiff {
  const maxPrefix = Math.min(oldText.length, newText.length)
  let prefixEnd = 0
  while (prefixEnd < maxPrefix && oldText[prefixEnd] === newText[prefixEnd]) prefixEnd++

  const maxSuffix = Math.min(oldText.length, newText.length) - prefixEnd
  let suffixLen = 0
  while (
    suffixLen < maxSuffix &&
    oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
  ) {
    suffixLen++
  }

  const suffixStart = oldText.length - suffixLen
  const changedNew = newText.slice(prefixEnd, newText.length - suffixLen)
  return { prefixEnd, suffixStart, changedNew }
}
