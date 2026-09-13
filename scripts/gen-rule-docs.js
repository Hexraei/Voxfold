/**
 * Generate `docs/rules.md` from the compiled rule set.
 *
 * Generated, never hand-edited: a rule table that drifts from the rules is worse than none.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ruleset = JSON.parse(
  readFileSync(join(root, 'packages/rules-recommended/src/generated/ruleset.json'), 'utf8'),
)

const CATEGORY_TITLES = {
  punctuation: 'Punctuation',
  'plain-words': 'Plain-word swaps',
  intensifier: 'Intensifiers',
  'inanimate-adverb': 'Adverbs on things',
  buzzword: 'Buzzwords',
  'opener-closer': 'Openers and closers',
  construction: 'Structural constructions',
  markdown: 'Markdown-specific',
}

/** What `--fix` will do with this rule, in plain words. */
function fixColumn(rule) {
  if (rule.fix?.type === 'replace') return 'auto-fix (replace)'
  if (rule.fix?.type === 'delete') return 'auto-fix (delete)'
  if (rule.suggest) return `suggests: ${rule.suggest.map((s) => s.label).join(' / ')}`
  return 'flag only'
}

function densityColumn(rule) {
  if (!rule.density) return '—'
  return `${rule.density.threshold}+ per ${rule.density.per}`
}

const byCategory = new Map()
for (const rule of ruleset.rules) {
  if (!byCategory.has(rule.category)) byCategory.set(rule.category, [])
  byCategory.get(rule.category).push(rule)
}

const lines = [
  '# Rules',
  '',
  `Generated from \`packages/rules-recommended/rules/*.yaml\`. Rule set \`${ruleset.name}@${ruleset.version}\`, ${ruleset.rules.length} rules.`,
  '',
  'Weight is the score cost per occurrence. Every occurrence is flagged; where a density',
  'threshold is set, occurrences below it cost a fraction of the weight instead of the whole.',
  '',
  '**Auto-fix** rules have exactly one correct result and are applied by `--fix`.',
  '**Suggests** offers choices a human picks. **Flag only** means the tool names the pattern and',
  'you write the replacement — that is the whole point of the linter.',
  '',
]

for (const [category, rules] of [...byCategory.entries()].sort()) {
  lines.push(`## ${CATEGORY_TITLES[category] ?? category}`, '')
  lines.push('| Rule | Weight | Density | Fix | Flags |')
  lines.push('|---|---|---|---|---|')
  for (const rule of rules.sort((a, b) => b.weight - a.weight)) {
    const example = rule.examples.flag[0]?.replace(/\|/g, '\\|') ?? ''
    lines.push(
      `| \`${rule.id}\` | ${rule.weight} | ${densityColumn(rule)} | ${fixColumn(rule)} | ${example} |`,
    )
  }
  lines.push('')
}

lines.push('## Details', '')
for (const rule of [...ruleset.rules].sort((a, b) => (a.id < b.id ? -1 : 1))) {
  lines.push(`### \`${rule.id}\``, '')
  lines.push(`${rule.message} — ${rule.docs}`, '')
  lines.push(`- kind: ${rule.kind}, weight: ${rule.weight}, fix: ${fixColumn(rule)}`)
  if (rule.formats) lines.push(`- only in: ${rule.formats.join(', ')}`)
  if (rule.appliesTo) lines.push(`- only on: ${rule.appliesTo.join(', ')}`)
  if (rule.skipIn) lines.push(`- skipped in: ${rule.skipIn.join(', ')}`)
  lines.push('')
  lines.push('Flags:')
  for (const example of rule.examples.flag) lines.push(`- ${example}`)
  lines.push('')
  lines.push('Passes:')
  for (const example of rule.examples.pass) lines.push(`- ${example}`)
  lines.push('')
}

mkdirSync(join(root, 'docs'), { recursive: true })
writeFileSync(join(root, 'docs/rules.md'), `${lines.join('\n')}\n`)
console.log(`Wrote docs/rules.md (${ruleset.rules.length} rules)`)
