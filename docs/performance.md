# Performance notes

Measured on the packaged (`dist/`) build, warm (JIT-settled, `compromise`'s own module-load
cost excluded), on ordinary dev hardware — not a formal benchmark suite, but real numbers from
real runs, not estimates.

| Scenario | Result | Budget |
|---|---|---|
| Overlay re-lint of a ~3,000-word page | ~97ms | <150ms (met) |
| `lint()` on a single ~10,000-word document | ~250–380ms | <80ms (**not met**) |
| Adapter `extract()` on a ~10,000-word Markdown file | ~30ms | — |
| CLI startup + single small file | well under a second | — |

The 3,000-word overlay budget — the number that actually matters for the live-edit
experience, since that's the largest page size the dev-server overlay is expected to re-lint
on every edit — is met.

**The 10,000-word single-document budget is not met**, and the reason is understood, not
mysterious: `compromise` (the part-of-speech tagger) is called once per prose block, and its
fixed per-call overhead dominates once a document has many blocks — a document with 401 small
paragraphs measured slower than the same total text as one large block, even though both
contain the same number of words. Batching the tagger call across a whole document (call
`compromise` once, split its output back out per block by offset) measurably helps in
isolation, but doing that properly means changing the `Tagger` interface's shape, which is a
real extension-point contract (the tagger is deliberately swappable, per its own module doc) —
not a change to make casually this close to a first release. Left as a known, tracked
limitation rather than a rushed interface change.

**Practical impact**: this only bites a single very large file (tens of thousands of words in
one document) linted through the CLI or CI. It does not affect the live-edit overlay (which
never sees a document that large in one page) or ordinary-sized files (a typical README,
component, or page is nowhere near 10,000 words).
