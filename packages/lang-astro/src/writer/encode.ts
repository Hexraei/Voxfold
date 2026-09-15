/**
 * Escape replacement text for an Astro template text-node context.
 *
 * The writer only ever patches inside an existing `text` node's own decoded `.value` — never
 * introduces a new element or expression. In text position, `<` starts a new tag and `{` starts a
 * new `{expr}` once the file is reparsed — both verified empirically: patching an unescaped
 * `<right after` into what was a single `text` node reparses into `text, element("right"), text`
 * (the new element even swallows the rest of the paragraph as its own child), and an unescaped
 * `{evil}` reparses into `text, expression, text` — both genuine structural changes the
 * fingerprint check correctly refuses.
 *
 * `&lbrace;`/`&rbrace;`/`&lt;` verified empirically to keep the node a single `text` node on
 * reparse. Unlike Svelte/Vue, `@astrojs/compiler` does NOT decode entities in a `text` node's
 * `.value` itself — this adapter's own `../template-entities.ts` does that decoding (both in
 * extract() and in the writer's `locate()`), so this escape round-trips exactly: `locate()` on
 * the reparsed file decodes `&lbrace;evil&rbrace;` back to `{evil}`, matching what `@voxfold/
 * writer`'s protocol requires (the patched text must read back byte-identical to what was
 * written). A bare `&` needs no escaping: verified empirically that `Tom & Jerry` round-trips as
 * a single `text` node unchanged, and `../template-entities.ts` only treats `&` as the start of
 * an entity when a valid, terminated entity actually follows.
 */
export function encodeTemplateText(decoded: string): string {
  return decoded.replace(/</g, '&lt;').replace(/\{/g, '&lbrace;').replace(/\}/g, '&rbrace;')
}
