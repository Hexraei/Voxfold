/**
 * Map each character of a template TEXT node's DECODED `.content` back to the source offset of
 * the raw character (or entity) that produced it.
 *
 * `@vue/compiler-sfc`'s template parser does TWO things to a text node's raw source before
 * `node.content` is produced, both of which need reconciling against source offsets:
 *
 *  1. HTML-entity decoding (`&amp;` → `&`, `&lt;` → `<`, …), same as `jsx-entities.ts` handles for
 *     Babel's `JSXText` and `collapseWhitespace` handles for parse5 in `@voxfold/lang-html`.
 *  2. Whitespace COLLAPSING (`condense: true`, the parser's default): any run of tabs/spaces/CRLF
 *     collapses to a single ` ` — verified empirically (`\r\n    Tom &amp;   Jerry` → `
 *     Tom & Jerry`), unlike Babel's `JSXText`, which hands React's own algorithm the raw text
 *     uncollapsed. This is functionally identical to what lang-html's `collapseWhitespace` does
 *     for parse5 text nodes, so this function mirrors it rather than the simpler 1:1 JSX version.
 */
export function templateTextOffsets(decoded: string, raw: string, start: number): Int32Array {
  const offsets: number[] = []
  let rawIndex = 0

  for (let i = 0; i < decoded.length; i++) {
    const char = decoded[i]!

    if (raw[rawIndex] === '&') {
      const semicolon = raw.indexOf(';', rawIndex)
      if (semicolon !== -1 && semicolon - rawIndex <= 32) {
        offsets.push(start + rawIndex)
        rawIndex = semicolon + 1
        continue
      }
    }

    if (char === ' ') {
      // A single collapsed space in `decoded` may correspond to a whole run of raw whitespace
      // (or exactly one raw space, when there was no run to collapse) — advance past the whole
      // run, keeping the run's first source offset, same rule lang-html's collapseWhitespace uses.
      offsets.push(start + rawIndex)
      while (rawIndex < raw.length && /\s/.test(raw[rawIndex]!)) rawIndex++
      continue
    }

    offsets.push(start + rawIndex)
    rawIndex++
  }

  return Int32Array.from(offsets)
}

/** True when every entry of `offsets` is exactly one past the previous — no charMap needed. */
export function isLinear(offsets: Int32Array): boolean {
  for (let i = 1; i < offsets.length; i++) {
    if (offsets[i] !== offsets[i - 1]! + 1) return false
  }
  return true
}
