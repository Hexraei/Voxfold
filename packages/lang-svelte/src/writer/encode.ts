/**
 * Escape replacement text for a Svelte template text-node context.
 *
 * The writer only ever patches inside an existing `Text` node's own decoded `.data` — never
 * introduces a new element or tag. In text position, `<` would start a new tag and `&` would
 * start a new entity, so both need HTML-entity-style escapes, same as `@voxfold/lang-html`'s
 * `encodeHtmlText` and `@voxfold/lang-vue`'s `encodeTemplateText`.
 *
 * `{` additionally needs escaping: a literal `{` in text position starts a new `{expr}` /
 * `{@html ...}` / `{#each}` tag once the file is reparsed, which would silently turn plain
 * replacement text into live template syntax — exactly the kind of structural change the writer
 * must never introduce. Verified empirically (see the module doc comment in `../index.ts` for the
 * spike methodology, and this package's `test/stamp.test.ts`/writer fault-injection tests for the
 * regression coverage): patching an unescaped `{evil}` into what was a single `Text` node reparses
 * into `Text, ExpressionTag, Text` — three sibling nodes, a genuine structural change the
 * fingerprint check correctly refuses. `&lbrace;`/`&rbrace;` decode to `{`/`}` as part of plain
 * TEXT-CONTENT decoding — no delimiter matching runs over already-decoded entity output — so the
 * node stays exactly one `Text` node, matching lang-vue's chosen escape (both `&lbrace;`/`&rbrace;`
 * and the numeric `&#123;`/`&#125;` forms verified to work identically; the named form is used for
 * consistency with the other adapters).
 */
export function encodeTemplateText(decoded: string): string {
  return decoded
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\{/g, '&lbrace;')
    .replace(/\}/g, '&rbrace;')
}
