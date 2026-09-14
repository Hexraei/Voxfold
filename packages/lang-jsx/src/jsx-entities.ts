/**
 * Map each character of a JSXText node's DECODED value back to the source offset of the entity
 * (or plain character) that produced it.
 *
 * Babel's JSX tokenizer decodes HTML entities in text position (`&amp;`, `&#123;`, `&#x7B;`) the
 * same way a browser does before `JSXText.value` is ever produced — see `jsxReadEntity` in
 * `@babel/parser`. That means `value.length` can differ from `end - start`, and offsets computed
 * against `value` directly (as `cleanJsxTextWithOffsets` alone would) drift the moment an entity
 * appears. This walks the decoded value against the raw source slice in lockstep, the same
 * technique `collapseWhitespace` in `@voxfold/lang-html` uses for the same underlying reason.
 */
export function jsxTextOffsets(decoded: string, raw: string, start: number): Int32Array {
  const offsets = new Int32Array(decoded.length)
  let rawIndex = 0

  for (let i = 0; i < decoded.length; i++) {
    if (raw[rawIndex] === '&') {
      const semicolon = raw.indexOf(';', rawIndex)
      // Babel's own entity reader bails after 10 characters without finding a `;` (see
      // jsxReadEntity), at which point a bare `&` is left as a literal `&` in the output — mirror
      // that cutoff so a stray `&` in ordinary prose is never mistaken for an entity.
      if (semicolon !== -1 && semicolon - rawIndex <= 10) {
        offsets[i] = start + rawIndex
        rawIndex = semicolon + 1
        continue
      }
    }
    offsets[i] = start + rawIndex
    rawIndex++
  }

  return offsets
}
