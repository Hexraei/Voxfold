<p align="center">
  <img src=".github/assets/logo.png" alt="Voxfold" width="480">
</p>

A style linter for the copy voice that AI-generated sites share: em-dash clusters,
"it's not just X, it's Y", "Fast. Simple. Secure.", "seamlessly", "robust".

Voxfold flags these patterns and gives your copy a **style score** (100 = clean). It fixes
only the mechanical ones ("utilize" → "use"). Rewriting a flagged sentence is left to you —
either in the CLI's own diff, or live on your dev server, where clicking a flag drops your
cursor straight into the exact sentence and writes your edit back to the real source file.
It runs offline and never calls an AI model. It is a pattern linter, not an AI detector: it
does not claim to know whether text was AI-written, only that it contains specific, named
tells worth a second look.

> **Status:** feature-complete for a first release; not yet published to npm.

## What it lints

Markdown/MDX, HTML, JSX/TSX, Vue SFCs, Svelte components, and Astro components — as files on
disk, or a live page via `voxfold <url>`.

```sh
npx voxfold README.md
npx voxfold src/**/*.tsx
npx voxfold https://example.com
```

```

README.md
  4:4      not-x-contrast           "X, not Y" contrast
  4:7      not-just-x-its-y         "not just X, it's Y" construction
  5:3      robust                   "robust"
  5:20     seamlessly               "seamlessly" [fixable]
  7:4      utilize                  "utilize" instead of "use" [fixable]

  Style score: 25 / 100  (F)   recommended@1.1.0+compromise@14.17.0
  2 fixable with --fix
  1 file, 5 flags, 115 words
```

`--fix` applies the mechanical fixes only — anything without one obvious correction is
flagged, never silently rewritten. `--min-score`/`--min-file-score` turn a run into a CI
gate (exit 1 on failure). `voxfold init` detects your framework and writes a starter config.

## Packages

| Package | Purpose |
|---|---|
| `voxfold` | CLI: lint files, globs and URLs; `--fix`; CI score gates; `init` |
| `@voxfold/core` | Pure rule engine: text + offset map in, flags + score out |
| `@voxfold/rules-recommended` | 60 starter rules, YAML-authored, compiled to JSON |
| `@voxfold/lang-markdown`, `-html`, `-jsx`, `-vue`, `-svelte`, `-astro` | One adapter per format: extract prose, and (where write-back applies) a verify-then-write patcher |
| `@voxfold/writer` | The safe-write protocol every write-capable adapter goes through: parse, patch, re-parse, byte-compare, only then write |
| `@voxfold/edit-server` | Transport-agnostic handlers (resolve/plan/apply/undo/suppress) shared by every dev integration |
| `@voxfold/overlay` | The live-edit browser UI: score badge, underlines, click-to-edit |
| `@voxfold/vite`, `@voxfold/astro`, `@voxfold/next` | Wires the overlay and edit server into each framework's dev server |
| GitHub Action | Sticky PR comment with the score delta, annotations on changed lines only |

## The live-edit overlay

Run your dev server with the matching integration installed (`voxfold init` tells you
which one), and a small badge appears in the corner showing your live score. Click it to see
every flag; click a flag to edit that exact sentence in place. Confirming the edit patches
your actual source file — JSX prop text, a Vue template, an MDX paragraph — through the same
verify-then-write protocol the CLI's `--fix` uses, then your dev server's own hot reload
picks it up.

- **Vite** (`@voxfold/vite`): React/JSX out of the box; also covers anything else already
  running on Vite (SvelteKit, Nuxt via `vite.plugins`).
- **Astro** (`@voxfold/astro`): stamps `.astro` templates and rendered Markdown/MDX alike;
  Astro's dev server is Vite underneath, so the edit server mounts the same way.
- **Next.js** (`@voxfold/next`): a standalone sidecar server, since Next has no
  `configureServer`-equivalent hook — verified working against Server Components, including
  through Next 16.3's `instrumentationClientInject`. Requires Next ≥16.3 for the automatic
  injection path; earlier versions need one manual `<VoxfoldOverlay/>` in the root layout.

Text that can't be safely mapped back to one exact place in your source — content from a
prop with more than one candidate, a `.map()`-rendered list item, an i18n key — gets an
honest "can't edit here" badge instead of a guess.

## What it deliberately doesn't do

- No AI anywhere in the linting or fix path. Every rule is a deterministic pattern match;
  every mechanical fix is a fixed string substitution. This is the whole point — flagging
  AI-flavored copy with more AI would just swap one kind of slop for another.
- No "AI-detection score." A style score measures surface patterns, not authorship.
- No hosted scanner, no browser extension. CLI, CI, and local dev server only.

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
