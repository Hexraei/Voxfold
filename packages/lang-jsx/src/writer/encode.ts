/**
 * Escape replacement text for a JSX child-text context.
 *
 * The writer only ever patches inside an existing `JSXText` node's own decoded value, or a
 * `StringLiteral` inside `{...}` — never introduces a new expression or element. In JSXText
 * position, `{` and `}` would start a new expression container and `<`/`>` would start a new
 * element, so those four characters need JSX's own escape hatches: `{'{'}`... but a
 * self-referential expression like that is exactly the kind of structural change the writer must
 * never silently introduce (see the protocol's fingerprint check) — so instead this follows what
 * a human typing plain replacement text into an editor would produce: HTML-entity-style escapes
 * for the characters that would otherwise be read as markup, which JSX (like HTML) also accepts
 * in text position.
 */
export function encodeJsxText(decoded: string): string {
  return decoded
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
}

/** Escape replacement text for a JS string-literal context, for whichever quote it already uses. */
export function encodeStringLiteral(decoded: string, quote: string): string {
  let escaped = decoded.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r')
  if (quote === "'") escaped = escaped.replace(/'/g, "\\'")
  else if (quote === '"') escaped = escaped.replace(/"/g, '\\"')
  else if (quote === '`') escaped = escaped.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
  return escaped
}
