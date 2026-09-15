/**
 * Escape replacement text for markdown plain-text context.
 *
 * The writer only ever patches inside an existing `text` node's own decoded value — never
 * introduces a new node, link, or emphasis span. So the only escaping question is: which
 * characters, if left bare in this position, would markdown's inline parser read as the start of
 * a construct that isn't there in the surrounding text? That's the same, narrower question
 * `mapEscapes` (in `../index.ts`) already answers on the way in by decoding a leading backslash,
 * so this is its inverse: escape a character exactly when a bare instance of it, followed by
 * whatever's already sitting right after this span in the source, could be misread.
 *
 * `mdast-util-to-markdown`'s own `unsafe` patterns (its `lib/unsafe.js`, checked directly rather
 * than assumed) are construct- and position-aware (`atBreak`, `inConstruct`, …) because it
 * serializes an arbitrary tree and must decide per-node-type; there's no standalone "escape this
 * string" export it exposes for a narrower patch-one-span job like this one. So this stays a
 * fixed, mostly position-agnostic escape set, verified empirically against a real
 * `mdast-util-from-markdown` reparse (see `packages/writer/test/markdown.test.ts` and this
 * package's own writer tests) rather than assumed correct from reading `unsafe.js` alone:
 *
 * - `\ \` * _ [ ] < ~ |` are escaped UNCONDITIONALLY, position-agnostic — verified harmless
 *   in plain-paragraph position even when not strictly needed there (e.g. a lone `~` or a `|`
 *   outside a table both parse fine either way), and REQUIRED in the position-sensitive case each
 *   guards against (emphasis/strong, link/image brackets, inline code, autolinks, strikethrough
 *   pairs, table cell delimiters).
 * - `# > - + 1.`-style markers are dangerous ONLY at the start of a line — verified empirically:
 *   `# text` / `- text` / `1. text` / `> text` as an ENTIRE paragraph's source do not even
 *   produce a paragraph node (they become a heading/list/blockquote instead), while the same
 *   marker later in a sentence is inert. `encode()` (the `AdapterWriter` contract) is only ever
 *   given the CHANGED-MIDDLE text a patch introduces, with no signal for where within the node's
 *   own value that middle lands — so these are escaped whenever they're the very FIRST character
 *   of the replacement text, which covers every case where the middle could coincide with a real
 *   line start, at the cost of occasionally escaping one that doesn't (verified harmless: an
 *   escaped `\#`/`\-`/`\>` mid-sentence decodes back to the identical bare character).
 */

const ALWAYS_ESCAPE = new Set(['\\', '`', '*', '_', '[', ']', '<', '~', '|'])
const LEADING_ESCAPE = new Set(['#', '>', '-', '+'])
const LEADING_ORDERED_LIST_MARKER = /^\d+\./

function escapeChar(char: string): string {
  return ALWAYS_ESCAPE.has(char) ? `\\${char}` : char
}

export function encodeMarkdownText(decoded: string): string {
  if (decoded.length === 0) return decoded

  let leading = ''
  let rest = decoded
  if (LEADING_ESCAPE.has(decoded[0]!)) {
    leading = `\\${decoded[0]}`
    rest = decoded.slice(1)
  } else {
    const orderedMatch = LEADING_ORDERED_LIST_MARKER.exec(decoded)
    if (orderedMatch) {
      leading = `${orderedMatch[0].slice(0, -1)}\\.`
      rest = decoded.slice(orderedMatch[0].length)
    }
  }

  let result = leading
  for (const char of rest) result += escapeChar(char)
  return result
}
