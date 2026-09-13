# Voxfold

A style linter for the copy voice that AI-generated sites share: em-dash clusters,
"it's not just X, it's Y", "Fast. Simple. Secure.", "seamlessly", "robust".

Voxfold flags these patterns and gives your copy a **style score** (100 = clean). It fixes
only the mechanical ones ("utilize" → "use"). Rewriting a flagged sentence is left to you,
right on your dev server. It runs offline and never calls an AI model. It is a pattern
linter, not an AI detector.

> **Status:** early development. Nothing is published yet.

## Planned packages

| Package | Purpose |
|---|---|
| `voxfold` | CLI: lint files, globs and URLs; `--fix`; CI score gates |
| `@voxfold/core` | Pure rule engine: text + offset map in, flags + score out |
| `@voxfold/vite`, `@voxfold/next`, `@voxfold/astro` | Dev overlay: click a flag, rewrite the text, write it back to source |
| GitHub Action | Score comment and annotations on every PR |

## Development

Requires Node 22.12+ and pnpm (via `corepack enable`).

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
```

## License

MIT
