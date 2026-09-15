/**
 * Escape replacement text for a Vue template text-node context.
 *
 * The writer only ever patches inside an existing template TEXT node's own decoded value — never
 * introduces a new element or interpolation. In text position, `<` would start a new tag and `&`
 * would start a new entity, so both need HTML-entity-style escapes, same as `@voxfold/lang-html`'s
 * `encodeHtmlText`.
 *
 * `{{` additionally needs escaping: two literal braces in text position start a NEW interpolation
 * once the file is reparsed, which would silently turn plain replacement text into live template
 * syntax — exactly the kind of structural change the writer must never introduce.
 *
 * The first attempt at this used `{{ '{{' }}` (an interpolation whose expression evaluates to the
 * literal string) — valid Vue and renders correctly, but it turned out to be the WRONG choice for
 * this writer specifically: `@vue/compiler-sfc`'s template parser splits a text node into
 * TEXT/INTERPOLATION/TEXT the moment it sees a real `{{...}}`, so patching a `{`-containing
 * replacement into what was a single TEXT node reparses into three sibling nodes — a genuine
 * structural change to the tree, not just this node's own value, which the fingerprint check
 * correctly refuses (see fault-injection-vue.test.ts's escaping test, and
 * writer/test/vue.test.ts's positive version of the same edit). `&lbrace;`/`&rbrace;` HTML
 * entities decode to `{`/`}` as part of plain TEXT-CONTENT decoding — no delimiter matching runs
 * over already-decoded entity output — so the node stays exactly one TEXT node, matching what a
 * human deliberately avoiding accidental template syntax would type.
 */
export function encodeTemplateText(decoded: string): string {
  return decoded
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\{/g, '&lbrace;')
    .replace(/\}/g, '&rbrace;')
}
