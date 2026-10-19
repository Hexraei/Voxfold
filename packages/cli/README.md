# voxfold

Style linter for AI-copy tells: em dashes, "not just X, it's Y", tricolons,
seamlessly/robust. No AI, no network, deterministic.

```sh
npx voxfold README.md
npx voxfold "src/**/*.{md,tsx}"
npx voxfold https://example.com
```

```
README.md
  4:4   not-x-contrast    "X, not Y" contrast
  5:20  seamlessly        "seamlessly" [fixable]

  Style score: 25 / 100  (F)
  1 file, 2 flags, 115 words
```

Voxfold lints Markdown/MDX, HTML, JSX/TSX, Vue, Svelte, and Astro files (or a live
page via URL) for named, mechanical writing patterns, and gives your copy a style
score (100 = clean). `voxfold --fix` rewrites only the rules with safe, fixed
substitutions ("utilize" -> "use"); everything else is left to you.

It is a pattern linter, not an AI detector: it never claims to know whether text was
AI-written, only that it contains specific tells worth a second look.

## Common flags

- `--fix` - apply the mechanical fixes in place
- `--format json` - machine-readable output for CI
- `--min-score <n>` - exit non-zero below a style score
- `--rules <set>` - choose the rule set (default: recommended)

Full documentation: <https://github.com/Hexraei/Voxfold>

## License

MIT
