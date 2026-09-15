/**
 * `@astrojs/compiler`'s `parse()` reports every `Position`/`Point.offset` as a UTF-8 BYTE offset
 * into the source, not a UTF-16 code-unit offset — confirmed both by the package's own type
 * comment (`Point.offset`: "0-based byte offset") and empirically, with a fixture containing an
 * emoji and curly quotes ahead of a plain-ASCII marker: `start.offset` for the marker text node
 * landed at the UTF-8 byte index (58), not the UTF-16 `String.prototype.indexOf` index (52).
 * `end.offset` on a `text` node is ALSO byte-based, and is not simply `start.offset + value.length`
 * even after converting (a Text node's `end` sometimes extends past its own decoded `.value`,
 * into trailing markup) — so every offset this adapter reads from the AST must go through
 * `byteToUtf16` before it does anything else, and no code downstream of that should ever add a
 * raw AST offset to anything.
 *
 * Every other adapter in this repo, and `@voxfold/core`'s own `Offset` type, assume UTF-16 code
 * units (documented in `core/src/types.ts`), so this conversion layer is required, not optional.
 */

/** Maps every UTF-8 byte offset in `source` to its corresponding UTF-16 code-unit offset. */
export class ByteOffsetMap {
  private readonly byteToUtf16: Int32Array

  constructor(source: string) {
    const byteLength = Buffer.byteLength(source, 'utf8')
    const map = new Int32Array(byteLength + 1)
    let byteOffset = 0
    for (let i = 0; i < source.length; ) {
      const codePoint = source.codePointAt(i)!
      const utf16Len = codePoint > 0xffff ? 2 : 1
      const byteLen = Buffer.byteLength(String.fromCodePoint(codePoint), 'utf8')
      for (let b = 0; b < byteLen; b++) map[byteOffset + b] = i
      byteOffset += byteLen
      i += utf16Len
    }
    map[byteOffset] = source.length
    this.byteToUtf16 = map
  }

  toUtf16(byteOffset: number): number {
    if (byteOffset < 0) return 0
    if (byteOffset >= this.byteToUtf16.length) return this.byteToUtf16[this.byteToUtf16.length - 1]!
    return this.byteToUtf16[byteOffset]!
  }
}
