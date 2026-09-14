# Calibration rationale

Fitted against `corpus/human/` (6 self-authored samples, 2948 words)
and `corpus/ai-style/` (6 self-authored samples, 2065 words),
using rules `recommended@1.0.0`. Regenerate with `node scripts/calibrate/run.js`
after any change to the rule set that shifts `tellsPer100` on this corpus, and commit the new
`calibration.json` with a minor version bump per the ruleset's own stability policy.

## Method

The curve is `score = 100 * exp(-tellsPer100 / tau)`. Tau is the only free constant. We search
tau from strict (5) upward and take the smallest value such that:

- the human corpus's **median** score is at least 92, and
- **at most 10%** of human samples score below a B (80).

Smallest, not merely sufficient: a larger tau makes every score more forgiving, so the goal is
the strictest curve that still treats ordinary, unpoliced human writing fairly — not the most
lenient curve that happens to pass.

## Result

- **tau = 10.5**
- Cutoffs: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, else F
- minWords = 80 (unchanged from the placeholder — no corpus evidence yet to move it)

### Human corpus scores

| File | Words | Flags | Tells/100 words | Score | Grade |
|---|---:|---:|---:|---:|---|
| api-reference.md | 610 | 1 | 0.10 | 99 | A |
| changelog.md | 370 | 0 | 0.00 | 100 | A |
| cli-help.md | 409 | 7 | 2.40 | 80 | B |
| engineering-notes.md | 596 | 3 | 0.30 | 97 | A |
| howto-guide.md | 562 | 3 | 0.32 | 97 | A |
| project-readme.md | 401 | 2 | 0.30 | 97 | A |

Median: **97**. Below B: 0 of 6.

### AI-style corpus scores (not part of the fitting target — reported for separation)

| File | Words | Flags | Tells/100 words | Score | Grade |
|---|---:|---:|---:|---:|---|
| api-reference.md | 420 | 38 | 28.02 | 7 | F |
| changelog.md | 299 | 39 | 32.71 | 4 | F |
| cli-help.md | 298 | 35 | 37.11 | 3 | F |
| engineering-notes.md | 383 | 27 | 19.40 | 16 | F |
| howto-guide.md | 358 | 26 | 25.17 | 9 | F |
| project-readme.md | 307 | 32 | 31.01 | 5 | F |

Median: **6**.

## Why this corpus and not a larger third-party one

The build plan calls for permissively licensed pre-2022 human text plus `corpus/SOURCES.md`
URLs fetched at calibration time. This environment has no network access this session, so every
file is original writing authored for this repo (see `corpus/SOURCES.md` for the full
disclosure) rather than text whose license can't be verified here. The human samples were written
first, in a plain, ordinary technical-writing voice, without checking them against the rule set —
none were edited to score better after the fact. The AI-style samples were written second, in the
recognizable marketing-copy voice the tool targets, also without tuning against the rule set
rule-by-rule.

This is a real limitation: six samples per side is a small corpus, and self-authored text is not
the same evidence as a large sample of real human and real AI-generated pages. Treat this as a
first calibration to be revisited once `corpus/SOURCES.md` can be fetched (a future run in an
environment with network access), not as a final answer. The separation between the two corpora
(human median 97 vs AI-style median 6) is the number worth
checking against intuition before trusting `tau` further.
