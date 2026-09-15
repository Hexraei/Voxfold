# Website Context: Voxfold

Handoff doc for building voxfold.dev (or equivalent). Read this before writing any
copy or code for the site. This describes the actual product — do not invent
features it doesn't have, and do not let site copy exhibit the exact tells Voxfold
itself flags (em dashes, "not just X, it's Y", "seamlessly", "robust", etc.) —
that would be an obvious, mockable self-own.

## What Voxfold is, in one paragraph

Voxfold is a deterministic style linter that catches the recognizable copy voice of
AI-generated text — em-dash clusters, "it's not just X, it's Y", tricolons like
"Fast. Simple. Secure.", and buzzwords like "seamlessly" and "robust" — and gives
a 0–100 style score. It runs as a CLI, a GitHub Action, and a live dev-server
overlay (Vite first) that lets you click a flagged sentence and rewrite it
yourself, writing the change straight back to your source file. No AI model is
ever called. It is a pattern linter, not an AI detector, and the site's copy
should never claim otherwise.

## Positioning (load-bearing, don't drift from this)

- **"Style score" / "style linter" / "tells"** — never "AI-detector" or
  "AI-detection probability". Voxfold does not claim to detect whether text was
  AI-written, only that it contains specific, named surface patterns.
- Deterministic and offline: no API key, no network call, no LLM anywhere in the
  linting or fix path. This is a core differentiator and a trust signal — say it
  plainly, don't bury it.
- Developer tool, not a SaaS product. No waitlist, no signup gate, no hosted
  scanner. The primary distribution surface is `npx voxfold <url>` run in a
  terminal — something people screenshot and share.
- Humble about scope: mechanical rules (like "utilize" → "use") get one
  auto-fix. Everything else ("not just X, it's Y", tricolons) is flagged but the
  rewrite is always left to a human. Voxfold does not generate replacement prose,
  ever — stating this clearly heads off "isn't this just more AI slop" pushback.

## Audience

Developers and technical writers shipping marketing sites, docs, READMEs, or
landing pages who want to catch AI-flavored copy before it ships — either their
own drafts or ones written with AI assistance. Secondary audience: teams who want
a CI gate (GitHub Action) so a style score regression fails a PR the same way a
lint or test failure would.

## What actually exists today (do not oversell)

Status: **early development, nothing published to npm yet.** The site should not
imply a stable public release, a live demo you can paste any URL into, or a
finished visual editor experience — those aren't real yet.

Built and working in the repo (`github.com/Hexraei/Voxfold`), commit by commit:
- **`@voxfold/core`** — the pure rule engine: text/offset-map in, flags + a 0–100
  score out. ~56 starter rules across punctuation, buzzwords, inanimate-subject
  adverbs, structural constructions ("not just X, it's Y", tricolons), openers
  like "in today's fast-paced world", and more.
- **Markdown and HTML adapters** — lints README files and rendered HTML pages,
  skipping code blocks, hidden elements, and legal/footer boilerplate.
- **CLI (`voxfold`)** — lints local files, folders, and URLs; `--fix` for
  mechanical rules; `--min-score` as a CI gate; JSON/SARIF/GitHub/markdown output
  formats.
- **Calibration** — the 0–100 score curve is fitted against a corpus of
  human-written text so a normal paragraph doesn't get unfairly dinged.
- **Safe writer** — a verify-then-write protocol (parse, patch, re-parse, byte-
  compare) that the live-edit overlay uses to write a rewritten sentence back to
  the exact source file location without corrupting anything else in it.
- **JSX/TSX adapter** — understands React's own whitespace rules well enough to
  find and safely rewrite prose text inside components.

In progress: the **live dev-server overlay** for Vite — a corner badge showing
score/grade, click a flagged sentence to edit it in place, and the edit writes
back to your source file with hot-reload picking it up immediately. This is the
flagship interaction the site should demo prominently once it's finished, but as
of now it should be described as "coming" or shown as a mockup/recording, not
promised as clickable today.

Planned, not yet started: Vue/Svelte/Astro adapters, Next.js integration, the
GitHub Action's sticky PR comment, and the public npm release.

## Key interaction to make visually clear on the site

1. A page loads in your local dev server with an unobtrusive score badge in the
   corner (off by default until toggled — it should never feel like a nag banner).
2. A flagged sentence is underlined (color-coded by category).
3. Click it → a popover explains the rule ("why this is flagged") and — if the
   text is editable from this exact spot — lets you type the fix directly, with
   the cursor already positioned in the flagged sentence.
4. Press enter → a diff appears → confirm → the source file on disk is patched
   ("changed" the same way a real code edit is) and undo is always available.

This end-to-end loop (not the score number alone) is the actual product; the
score is a byproduct that happens to be a good headline stat and shareable
leaderboard hook.

## Tone and voice for the site itself

Plain, direct, slightly wry about the irony of a linter-for-AI-slop needing to
avoid sounding like AI slop itself. Short sentences. Concrete before/after
examples (show a flagged sentence and its human rewrite) rather than adjectives
describing how good the tool is. No stock-photo "team collaborating around a
laptop" imagery — a terminal screenshot or the live overlay in action is more
credible for this audience.

## Assets / references available in the repo

- `README.md` — current short-form pitch, keep the site's headline consistent
  with it rather than drifting to a different claim.
- `examples/vite-react/src/App.tsx` — deliberately contains every kind of tell
  Voxfold catches (em dashes, "not just X, it's Y", "cutting-edge",
  "seamlessly", "utilize", "robust", "holistic", "meticulously crafted", etc.) —
  useful as a ready-made before/after demo without writing new fixture copy.
- The build plan (not in this repo) defines the full rule catalog and roadmap if
  a "what's next" or changelog section is wanted.

## What NOT to put on the site

- Any claim of AI-authorship detection or a confidence percentage that text is
  AI-generated.
- A live "paste your URL, get an AI-detection score" demo — that misrepresents
  what the tool measures and invites exactly the false-claim pushback the
  project has deliberately avoided from day one.
- Pricing, plans, or signup flows — there is no product to sell yet, only an
  open-source tool.
