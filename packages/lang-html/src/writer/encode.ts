/**
 * Escape replacement text for an HTML text-node context.
 *
 * A text node's raw source can hold entities (`&amp;`), but its rendered/decoded value only ever
 * needs `&` and `<` re-escaped to stay text rather than starting a new tag or entity when written
 * back. `>` does not need escaping outside of a tag's own markup — only `&` and `<` are special
 * in text content per the HTML spec — so this deliberately does not touch it, matching what a
 * human pasting plain text into an editor would produce.
 */
export function encodeHtmlText(decoded: string): string {
  return decoded.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}
