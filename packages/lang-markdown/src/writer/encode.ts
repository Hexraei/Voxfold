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
 * `mdast-util-to-markdown`'s full escaping is construct-aware (link titles, code fences, and so
 * on) because it can emit any node type. This writer never does — text stays text — so a fixed,
 * position-agnostic escape set for the characters markdown treats specially inside a paragraph is
 * both correct for this narrower job and matches what a human would type to get this exact text
 * back.
 */

const ALWAYS_ESCAPE = new Set(['\\', '`', '*', '_', '[', ']', '<'])

export function encodeMarkdownText(decoded: string): string {
  let result = ''
  for (const char of decoded) {
    if (ALWAYS_ESCAPE.has(char)) result += `\\${char}`
    else result += char
  }
  return result
}
