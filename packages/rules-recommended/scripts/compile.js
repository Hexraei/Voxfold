/**
 * Compile the YAML rule files into one JSON module.
 *
 * YAML is for humans curating rules (comments, readable multi-line messages); JSON is what ships,
 * so the browser overlay never has to carry a YAML parser. Validation happens here, at build
 * time, rather than in the engine at run time.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const here = dirname(fileURLToPath(import.meta.url))
const rulesDir = join(here, '..', 'rules')
const outDir = join(here, '..', 'src', 'generated')

/** Rule set version. Bump the minor when a change moves scores; see README. */
const VERSION = '1.0.0'

const KINDS = new Set(['mechanical', 'structural'])
const SEVERITIES = new Set(['off', 'warn', 'error'])
const CATEGORIES = new Set([
  'punctuation',
  'plain-words',
  'intensifier',
  'inanimate-adverb',
  'buzzword',
  'opener-closer',
  'construction',
  'markdown',
])
const MATCHER_TYPES = new Set(['words', 'phrases', 'chars', 'regex', 'tokens', 'detector'])
const DETECTORS = new Set([
  'contrastive-negation',
  'tricolon-fragments',
  'negation-triplet',
  'rhetorical-qa',
  'x-meets-y',
  'from-x-to-y',
  'parallel-pair',
  'adverb-inanimate-subject',
  'emoji-heading',
  'bold-lead-in-list',
])

const errors = []
const seen = new Set()

function check(condition, ruleId, message) {
  if (!condition) errors.push(`${ruleId}: ${message}`)
}

function validate(rule, file) {
  const id = rule?.id ?? `<missing id in ${file}>`
  check(typeof rule.id === 'string' && /^[a-z0-9-]+$/.test(rule.id), id, 'id must be kebab-case')
  check(!seen.has(rule.id), id, 'duplicate rule id')
  seen.add(rule.id)

  check(rule.lang === 'en', id, 'lang must be "en"')
  check(KINDS.has(rule.kind), id, `kind must be one of ${[...KINDS].join(', ')}`)
  check(CATEGORIES.has(rule.category), id, `unknown category "${rule.category}"`)
  check(SEVERITIES.has(rule.severity), id, `unknown severity "${rule.severity}"`)
  check(typeof rule.weight === 'number' && rule.weight > 0, id, 'weight must be a positive number')
  check(typeof rule.message === 'string' && rule.message.length > 0, id, 'message is required')
  check(typeof rule.docs === 'string' && rule.docs.length > 0, id, 'docs is required')

  check(rule.match && MATCHER_TYPES.has(rule.match?.type), id, 'match.type is invalid')
  if (rule.match?.type === 'detector') {
    check(DETECTORS.has(rule.match.detector), id, `unknown detector "${rule.match.detector}"`)
  }
  if (rule.match?.type === 'regex') {
    try {
      new RegExp(rule.match.pattern, 'gu')
    } catch (error) {
      check(false, id, `invalid regex: ${error.message}`)
    }
  }

  // The whole product rests on this: structural tells have no single correct rewrite, so they
  // must never carry an automatic fix.
  check(
    !(rule.kind === 'structural' && rule.fix),
    id,
    'structural rules must not define a fix (the human writes the replacement)',
  )

  check(
    Array.isArray(rule.examples?.flag) && rule.examples.flag.length > 0,
    id,
    'needs flag examples',
  )
  check(
    Array.isArray(rule.examples?.pass) && rule.examples.pass.length > 0,
    id,
    'needs pass examples',
  )
}

const rules = []
for (const file of readdirSync(rulesDir).sort()) {
  if (!file.endsWith('.yaml')) continue
  const parsed = parse(readFileSync(join(rulesDir, file), 'utf8'))
  if (!Array.isArray(parsed)) {
    errors.push(`${file}: expected a list of rules`)
    continue
  }
  for (const rule of parsed) {
    validate(rule, file)
    rules.push(rule)
  }
}

if (errors.length > 0) {
  console.error(`Rule validation failed:\n${errors.map((error) => `  - ${error}`).join('\n')}`)
  process.exit(1)
}

rules.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
const ruleset = { name: 'recommended', version: VERSION, rules }

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'ruleset.json'), `${JSON.stringify(ruleset, null, 2)}\n`)
console.log(`Compiled ${rules.length} rules → src/generated/ruleset.json (recommended@${VERSION})`)
