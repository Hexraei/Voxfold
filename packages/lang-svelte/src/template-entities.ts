/**
 * Map each character of a template `Text` node's decoded `.data` back to the source offset of
 * the raw character (or entity) that produced it.
 *
 * Unlike `@vue/compiler-sfc` (`condense: true` by default), `svelte/compiler` does NOT collapse
 * whitespace in `Text` nodes — verified empirically: parsing `<p>Tom &amp; Jerry\r\n    utilize
 * ...</p>` produced `data: "Tom & Jerry\r\n    utilize ..."`, i.e. the `\r\n    ` run survives
 * untouched. So the only non-linear transform here is HTML-entity decoding (`&amp;` → `&`,
 * `&lbrace;` → `{`, …) — same shape as `@voxfold/lang-html`'s entity handling, simpler than
 * lang-vue's (which also has to account for whitespace collapsing).
 */
export function templateTextOffsets(decoded: string, raw: string, start: number): Int32Array {
  const offsets: number[] = []
  let rawIndex = 0

  for (let i = 0; i < decoded.length; i++) {
    if (raw[rawIndex] === '&') {
      const semicolon = raw.indexOf(';', rawIndex)
      if (semicolon !== -1 && semicolon - rawIndex <= 32) {
        offsets.push(start + rawIndex)
        rawIndex = semicolon + 1
        continue
      }
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
