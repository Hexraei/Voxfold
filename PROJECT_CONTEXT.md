# Project Context: AI-Copy Linter + Live Edit Overlay

Handoff doc for Claude Code. Read this fully before writing any code.

## Problem

Vibe-coded / AI-generated websites share a recognizable copy voice: em dashes,
"it's not just X, it's Y" constructions, tricolons ("Simple. Fast. Powerful."),
overused adverbs ("quietly", "effortlessly", "seamlessly"), and generic hedge
words ("robust", "utilize", "in today's fast-paced world"). This is a visible
tell that a site was AI-written and not reviewed by a human.

AI cannot fix this by rewriting the copy — that just produces different slop.
The fix has to be: flag the tell, then let the human rewrite it themselves,
as close as possible to the point where they'd otherwise be editing raw code.

## Product shape

One core rule engine, three thin delivery adapters, all developer-facing only.
No web app, no browser extension, no hosted scanner — CLI + local dev only.

### 1. Core package (the brain)
- Pure function: text/offset-map in → list of flags + score out.
- No file I/O, no network, no UI.
- Two rule types:
  - **Auto-fixable / mechanical**: single obvious correction. Em dash → comma
    or period. "utilize" → "use". Delete "seamlessly", "robust",
    "effortlessly", "in today's fast-paced world".
  - **Flag-only / structural**: no single correct fix, just underline + name
    the tell. "Not just X, it's Y" construction. Tricolon ("Fast. Simple.
    Secure."). Adverbs like "quietly"/"gently" on inanimate subjects.
- Rules live in a JSON/YAML rule file, not hardcoded in the engine — rules are
  data, engine is code. This lets rule wording/weights be tuned without
  touching the matching logic.
- Score is pure arithmetic, not AI: `score = (Σ rule_weight hits) / word_count
  × 100`, then mapped to 0–100 or a letter grade. Deterministic, same input →
  same output every time. Call it a "style score", never "AI-detection
  probability" — we are not claiming to detect AI, only flagging surface
  patterns. Gate scoring on a minimum word count so tiny pages don't score.
- Detection should key off **density**, not mere presence (e.g. 3 em dashes
  in one paragraph is a signal; 1 is not).

### 2. CLI
- `npx <name> <path|glob|url>` — lints local files or fetches a URL's
  rendered HTML (works for SSR/static sites; SPA/client-rendered pages will
  return an empty shell and should print a clear message saying so, not
  a false score).
- Also lints Markdown (READMEs/docs) — see "Markdown adapter" below.
- Prints flags with line numbers + the score.
- `--min-score N` exits 1 if the score is below the threshold — this is what lets it
  live in CI.
- `--fix` applies only the mechanical/auto-fixable rules.
- `--format json` for scripting.
- Config file resolution + inline disable comments + exit codes, same
  conventions as ESLint — copy these, don't reinvent.
- No hosting cost — this is the primary viral/distribution surface
  (`npx <name> https://yoursite.com` from a terminal, screenshot-able).

### 3. Build plugin (the actual product)
- Vite plugin first, Next.js after.
- Injects an overlay into the dev server (like the Vercel/Next dev toolbar
  logo-corner affordance) over the live localhost preview.
- Flags render drawn over the live page at the exact text node.
- Click a flag → cursor drops directly into edit mode on that exact text
  node (critical UX detail — do not make the user hunt for the sentence
  again).
- User retypes in their own words → overlay writes the change back to the
  **source file** (JSX/TSX/Vue SFC/Svelte/Astro), not just the DOM.
- The linter/overlay itself never generates replacement prose for
  flag-only rules — only mechanical mechanical fixes are auto-applied.
  Writing the actual sentence is always the human's job.

### 4. GitHub Action
- Runs the CLI on every PR, comments the score inline.
- Turns a one-off check into a standing team-level nag.

## Hard technical problems (in priority order)

1. **Source mapping (JSX)**: map a DOM text node back to its exact JSX string
   literal + byte offset so we can patch it. Static JSX text children are
   tractable (React dev transform already exposes fileName/lineNumber, same
   mechanism click-to-source tools use). Explicitly OUT OF SCOPE for v1: text
   from props, `.map()`-rendered arrays, i18n keys, template literals,
   constants imported from another file, server components. Show an honest
   "this text comes from a variable, can't edit here" badge rather than
   guessing wrong — this refusal is a feature, not a bug.
2. **AST-only writes, never regex/line-based replacement.** Get byte offsets
   from the parser, patch, then re-parse the patched file and assert only the
   intended node changed before writing. If the file doesn't re-parse
   cleanly, refuse to write. This tool edits users' source files directly —
   a bad offset calculation corrupting someone's repo is the single biggest
   risk to the whole project's credibility.
3. **Show a diff before writing** + check git status/working-tree-clean
   before allowing writes.
4. **Inline formatting splits sentences into multiple nodes.** E.g.
   `<p>Our platform <strong>doesn't just</strong> manage tasks</p>` or in MD:
   `It's **not just** a tool, it's a workflow.` — arrives as 3+ separate
   text/inline nodes, so naive per-node matching misses the "not just X,
   it's Y" pattern entirely.
   **Fix (build once, reuse everywhere)**: flatten each block's inline
   children into one continuous string while keeping a char-offset → original
   file-position map. Lint the flat string. Translate flag positions back
   through the map. This is the single most important shared piece of
   infrastructure — solve it once in core, both the JSX adapter and the
   Markdown adapter consume it.
5. **HMR remounting mid-edit** — needs handling so an in-progress edit isn't
   lost on hot reload.

## Markdown adapter (README/docs linting)

- Use `remark`/`unified`/`mdast` (`remark-parse` + `unist-util-visit`), NOT
  regex over raw markdown text.
- Walk `paragraph` (and similar prose) nodes, flatten inline children per the
  offset-map approach above, run through the same core engine.
- Every mdast node has `position` (line/column/offset) — reuse this for
  reporting and for `--fix` targeting.
- **Skip entirely**: `code`/`inlineCode` nodes, YAML frontmatter, raw `html`
  nodes, link URLs (but DO lint visible link text), image alt text, badge
  lines.
- **Rule adjustments for markdown**: don't fire the tricolon rule on list
  items (3 bullets is normal, not a rhetorical flourish); loosen em-dash
  density threshold for headings (too short, trips the ratio unfairly).
- Worth reviewing `textlint`'s rule interface before designing ours — it's a
  solved design for pluggable prose rules, reference it rather than
  reinventing.
- End state: core package takes a flattened string + offset map and returns
  flags, regardless of source format. JSX adapter and Markdown adapter (and
  future HTML adapter) are both just "walk tree → decide what's prose →
  flatten → map offsets back" wrappers around the same core.

## Explicit non-goals for v1

- No hosted web scanner, no browser extension, no Playwright/headless
  browser rendering — CLI + build plugin only, purely developer-facing.
- No AI/LLM anywhere in the linting or fix-suggestion path. Mechanical fixes
  are deterministic string rules; structural flags are flag-only, human
  writes the fix. This is a core differentiator (offline, no API key, no
  cost) — do not compromise it later for "smarter" suggestions.
- Not attempting real AI-authorship detection/classification. Explicitly a
  style/pattern linter, not a detector — framing and copy should reflect
  this to avoid false-claim pushback.

## Reference prior art (for design inspiration, not to copy wholesale)

- **Onlook** — open source React visual editor, writes back to source,
  preserves component structure. Full canvas app though, heavier than what
  we want.
- **Glide** — click element on live canvas, edit, writes back to
  JSX/TSX/Vue/Svelte/Astro/HTML directly, no cloud. Closest existing analog
  to the build-plugin piece.
- **Lovable** "Edit text inline" (press T) — hosted only, doesn't touch local
  repo, but a good reference for the click-to-edit UX.
- **getinput** — contenteditable overlay for Next.js, but routes edits
  through Claude Code / an agent. We explicitly do NOT want an agent in this
  loop.
- **stagewise** — click elements to give a coding agent context. Same "agent
  in the loop" pattern we're avoiding.
- `write-good`, `alex`, `textlint` — existing prose-linting rule engines,
  worth reading before designing the rule format.

## Build/ship order

1. Core rule engine (pure function, JSON/YAML rules, fixture-tested — a
   folder of input files + expected output files, including ugly cases:
   apostrophes, nested tags, template literals, multiline text).
2. CLI wrapping the core engine (local files + URL fetch + markdown).
3. Vite build plugin (the actual edit-in-place product).
4. Next.js build plugin.
5. GitHub Action.

Given this is being built entirely with AI/agentic coding and not by hand:
fixture-test the AST writer *before* writing the writer — agents fail hardest
and most silently exactly here (wrong byte offset, corrupted source file, no
thrown error). Rules-as-data keeps rule curation (a taste/judgment task)
separate from engine logic (a code-correctness task).

## Naming / positioning notes

- Short name, no "AI" in it, works as a typed CLI command — register of a
  linter, not a SaaS product.
- Positioning: "style score" / "style linter" / named "tells", never
  "AI-detector" or "AI-detection probability".
- No waitlist, no gating — friction is the main adoption risk for a free
  open-source dev tool.

## Marketing context (already in progress, for continuity — not a build task)

- Plan: Show HN post (CLI one-liner + honest limitations in first comment) +
  X posts (split-screen demo video, terminal screenshots) + a "leaderboard"
  scan of well-known sites' scores as a shareable/viral asset + a README
  shield/badge showing a repo's copy score.
- A LinkedIn "curiosity" post teasing the build is planned/in progress
  separately from the Claude Code build work.
