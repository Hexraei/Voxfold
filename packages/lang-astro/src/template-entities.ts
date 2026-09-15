/**
 * Decode HTML entities in an Astro template `text` node's raw source, and map each decoded
 * character back to the source offset of the raw character (or entity) that produced it.
 *
 * REQUIRED, UNLIKE SVELTE/VUE: `@astrojs/compiler`'s `text` node `.value` does NOT decode HTML
 * entities at all — verified empirically (see `index.ts`'s module doc): `&amp;`, `&lt;`,
 * `&#123;`, `&#x7B;` all pass through `.value` completely untouched. Every other HTML-flavored
 * adapter in this repo (`lang-html` via parse5, `lang-svelte`/`lang-vue` via their own compilers)
 * gets entity decoding for free from its underlying parser; this one does not, so it is done here
 * — both so extract() reports what a reader actually sees (`&amp;` should read as `&`, not as
 * literal entity text), and so the writer's round-trip contract holds: `encode()` (see
 * `writer/encode.ts`) escapes a literal `<`/`{`/`}` as `&lt;`/`&lbrace;`/`&rbrace;` to keep the
 * file parseable, and `locate()` must decode that back to the exact text that was written, or the
 * writer protocol's "reads back as X, expected Y" check (`@voxfold/writer`'s `protocol.ts`)
 * fails — caught by a real fault-injection-style test run, not assumed.
 *
 * Named entity table is deliberately small: the handful `encodeTemplateText` can produce, plus
 * the common ones a human is likely to type by hand in prose (curly quotes, dashes, nbsp, basic
 * XML entities). An unrecognized `&name;` or `&name` with no terminating `;` is left as literal
 * text, matching how a browser's non-strict entity parser falls back.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  lbrace: '{',
  rbrace: '}',
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
}

/** Decode one entity starting at `raw[start]` (which must be `&`). Returns the decoded string and
 * how many raw characters it consumed, or undefined if `raw[start..]` isn't a recognized entity. */
function decodeEntityAt(raw: string, start: number): { text: string; length: number } | undefined {
  const semicolon = raw.indexOf(';', start)
  if (semicolon === -1 || semicolon - start > 32) return undefined
  const body = raw.slice(start + 1, semicolon)
  const length = semicolon - start + 1

  if (body[0] === '#') {
    const isHex = body[1] === 'x' || body[1] === 'X'
    const codeText = isHex ? body.slice(2) : body.slice(1)
    if (codeText.length === 0 || !/^[0-9a-fA-F]+$/.test(codeText)) return undefined
    const code = Number.parseInt(codeText, isHex ? 16 : 10)
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return undefined
    try {
      return { text: String.fromCodePoint(code), length }
    } catch {
      return undefined
    }
  }

  const named = NAMED_ENTITIES[body]
  return named !== undefined ? { text: named, length } : undefined
}

export interface DecodedText {
  decoded: string
  /** Source offset for each decoded character. */
  offsets: Int32Array
}

/** Decode entities in `raw` (the exact source slice for one text node, starting at `start`),
 * producing the flattened decoded string plus a source offset per decoded character. */
export function decodeTemplateText(raw: string, start: number): DecodedText {
  const decoded: string[] = []
  const offsets: number[] = []
  let i = 0

  while (i < raw.length) {
    if (raw[i] === '&') {
      const entity = decodeEntityAt(raw, i)
      if (entity) {
        for (const ch of entity.text) {
          decoded.push(ch)
          offsets.push(start + i)
        }
        i += entity.length
        continue
      }
    }
    decoded.push(raw[i]!)
    offsets.push(start + i)
    i++
  }

  return { decoded: decoded.join(''), offsets: Int32Array.from(offsets) }
}

/** True when every entry of `offsets` is exactly one past the previous — no charMap needed. */
export function isLinear(offsets: Int32Array): boolean {
  for (let i = 1; i < offsets.length; i++) {
    if (offsets[i] !== offsets[i - 1]! + 1) return false
  }
  return true
}
