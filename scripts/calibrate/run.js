/**
 * Fits `tau` (the score curve's only free constant) and the grade cutoffs against the corpus in
 * `corpus/human/` and `corpus/ai-style/`, and writes the result to
 * `packages/core/src/score/calibration.json` plus a written rationale to
 * `corpus/CALIBRATION.md`.
 *
 * Fitting rule (from the build plan): pick the smallest tau such that the human corpus's median
 * score is at least 92 and no more than 10% of human samples fall below a B. "Smallest" rather
 * than "any tau that satisfies both" because a smaller tau is a stricter curve — we want the
 * strictest curve that still treats ordinary human writing fairly, not the most lenient one that
 * happens to clear the bar.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gradeFor, lint } from '@voxfold/core'
import { markdownAdapter } from '@voxfold/lang-markdown'
import { recommended } from '@voxfold/rules-recommended'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function loadCorpus(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
  return files.map((file) => {
    const text = readFileSync(join(dir, file), 'utf8')
    const document = markdownAdapter.extract(text, { uri: file })
    const result = lint(document, recommended)
    return {
      file,
      words: result.stats.words,
      contribution: result.stats.contribution,
      tellsPer100: (result.stats.contribution / result.stats.words) * 100,
      flags: result.flags.length,
    }
  })
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function scoreAt(tau, tellsPer100) {
  return Math.max(0, Math.min(100, Math.round(100 * Math.exp(-tellsPer100 / tau))))
}

const human = loadCorpus(join(root, 'corpus/human'))
const aiStyle = loadCorpus(join(root, 'corpus/ai-style'))

console.log('--- human corpus ---')
for (const doc of human) {
  console.log(
    `  ${doc.file.padEnd(24)} words=${doc.words} flags=${doc.flags} tellsPer100=${doc.tellsPer100.toFixed(3)}`,
  )
}
console.log('--- ai-style corpus ---')
for (const doc of aiStyle) {
  console.log(
    `  ${doc.file.padEnd(24)} words=${doc.words} flags=${doc.flags} tellsPer100=${doc.tellsPer100.toFixed(3)}`,
  )
}

const CUTOFFS = { A: 90, B: 80, C: 70, D: 60 }

function evaluate(tau) {
  const humanScores = human.map((d) => scoreAt(tau, d.tellsPer100))
  const belowB = humanScores.filter((s) => s < CUTOFFS.B).length
  return {
    tau,
    humanScores,
    humanMedian: median(humanScores),
    belowBFraction: belowB / humanScores.length,
  }
}

// Search taus from strict to lenient; take the first (smallest) that clears both bars.
let chosen
for (let tau = 5; tau <= 100; tau += 0.5) {
  const result = evaluate(tau)
  if (result.humanMedian >= 92 && result.belowBFraction <= 0.1) {
    chosen = result
    break
  }
}

if (!chosen) {
  console.error('No tau in [5, 100] satisfies the fitting rule against this corpus.')
  process.exit(1)
}

const tau = chosen.tau
const aiScores = aiStyle.map((d) => scoreAt(tau, d.tellsPer100))

console.log(`\nChosen tau = ${tau}`)
console.log(`Human median score: ${chosen.humanMedian}`)
console.log(`Human scores: ${chosen.humanScores.join(', ')}`)
console.log(`Human fraction below B (${CUTOFFS.B}): ${(chosen.belowBFraction * 100).toFixed(1)}%`)
console.log(`AI-style scores: ${aiScores.join(', ')}`)
console.log(`AI-style median score: ${median(aiScores)}`)

const calibration = {
  tau,
  cutoffs: CUTOFFS,
  minWords: 80,
}

const rulesetVersion = recommended.version

writeFileSync(
  join(root, 'packages/core/src/score/calibration.json'),
  `${JSON.stringify({ ...calibration, rulesetVersion, fittedAt: '2026-09-14' }, null, 2)}\n`,
)

const rationale = `# Calibration rationale

Fitted against \`corpus/human/\` (6 self-authored samples, ${human.reduce((s, d) => s + d.words, 0)} words)
and \`corpus/ai-style/\` (6 self-authored samples, ${aiStyle.reduce((s, d) => s + d.words, 0)} words),
using rules \`recommended@${rulesetVersion}\`. Regenerate with \`node scripts/calibrate/run.js\`
after any change to the rule set that shifts \`tellsPer100\` on this corpus, and commit the new
\`calibration.json\` with a minor version bump per the ruleset's own stability policy.

## Method

The curve is \`score = 100 * exp(-tellsPer100 / tau)\`. Tau is the only free constant. We search
tau from strict (5) upward and take the smallest value such that:

- the human corpus's **median** score is at least 92, and
- **at most 10%** of human samples score below a B (${CUTOFFS.B}).

Smallest, not merely sufficient: a larger tau makes every score more forgiving, so the goal is
the strictest curve that still treats ordinary, unpoliced human writing fairly — not the most
lenient curve that happens to pass.

## Result

- **tau = ${tau}**
- Cutoffs: A ≥ ${CUTOFFS.A}, B ≥ ${CUTOFFS.B}, C ≥ ${CUTOFFS.C}, D ≥ ${CUTOFFS.D}, else F
- minWords = 80 (unchanged from the placeholder — no corpus evidence yet to move it)

### Human corpus scores

| File | Words | Flags | Tells/100 words | Score | Grade |
|---|---:|---:|---:|---:|---|
${human
  .map((d, i) => {
    const s = chosen.humanScores[i]
    return `| ${d.file} | ${d.words} | ${d.flags} | ${d.tellsPer100.toFixed(2)} | ${s} | ${gradeFor(s, calibration)} |`
  })
  .join('\n')}

Median: **${chosen.humanMedian}**. Below B: ${chosen.humanScores.filter((s) => s < CUTOFFS.B).length} of ${chosen.humanScores.length}.

### AI-style corpus scores (not part of the fitting target — reported for separation)

| File | Words | Flags | Tells/100 words | Score | Grade |
|---|---:|---:|---:|---:|---|
${aiStyle
  .map((d, i) => {
    const s = aiScores[i]
    return `| ${d.file} | ${d.words} | ${d.flags} | ${d.tellsPer100.toFixed(2)} | ${s} | ${gradeFor(s, calibration)} |`
  })
  .join('\n')}

Median: **${median(aiScores)}**.

## Why this corpus and not a larger third-party one

The build plan calls for permissively licensed pre-2022 human text plus \`corpus/SOURCES.md\`
URLs fetched at calibration time. This environment has no network access this session, so every
file is original writing authored for this repo (see \`corpus/SOURCES.md\` for the full
disclosure) rather than text whose license can't be verified here. The human samples were written
first, in a plain, ordinary technical-writing voice, without checking them against the rule set —
none were edited to score better after the fact. The AI-style samples were written second, in the
recognizable marketing-copy voice the tool targets, also without tuning against the rule set
rule-by-rule.

This is a real limitation: six samples per side is a small corpus, and self-authored text is not
the same evidence as a large sample of real human and real AI-generated pages. Treat this as a
first calibration to be revisited once \`corpus/SOURCES.md\` can be fetched (a future run in an
environment with network access), not as a final answer. The separation between the two corpora
(human median ${chosen.humanMedian} vs AI-style median ${median(aiScores)}) is the number worth
checking against intuition before trusting \`tau\` further.
`

writeFileSync(join(root, 'corpus/CALIBRATION.md'), rationale)

console.log('\nWrote packages/core/src/score/calibration.json and corpus/CALIBRATION.md')
