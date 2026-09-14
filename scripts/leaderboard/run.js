/**
 * Reproducible leaderboard: lints each site in `sites.yaml` with the built CLI and writes a
 * dated report to `leaderboard/<date>.{md,csv}`.
 *
 * Scoped to single pages for now: `voxfold --crawl` is designed but not yet implemented (see
 * `packages/cli/src/cli.ts`), so a full-site crawl isn't possible yet. Once it lands, this script
 * should pass `--crawl --max-pages 20` and report the per-site total the CLI already computes,
 * rather than linting one page per site by hand as it does today.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const here = dirname(fileURLToPath(import.meta.url))
const cliBin = join(root, 'packages/cli/bin/voxfold.js')

const { sites } = parse(readFileSync(join(here, 'sites.yaml'), 'utf8'))

if (!sites || sites.length === 0) {
  console.log('sites.yaml has no sites configured; nothing to run. See the comment at its top.')
  process.exit(0)
}

const cliPackageJson = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'))
const rulesPackageJson = JSON.parse(
  readFileSync(join(root, 'packages/rules-recommended/package.json'), 'utf8'),
)

const rows = []
for (const site of sites) {
  console.log(`Linting ${site.name} (${site.url})...`)
  let json
  try {
    const output = execFileSync(
      process.execPath,
      [cliBin, site.url, '--format', 'json', '--quiet'],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    )
    json = JSON.parse(output)
  } catch (error) {
    // voxfold exits non-zero on a gate failure or fatal error; both still print JSON on stdout
    // except a fatal error, which prints to stderr and leaves stdout empty.
    const stdout = error.stdout?.toString()
    if (!stdout) {
      console.error(`  fetch/lint failed: ${error.stderr?.toString().trim() ?? error.message}`)
      rows.push({ name: site.name, url: site.url, score: null, grade: null, words: 0, flags: 0 })
      continue
    }
    json = JSON.parse(stdout)
  }
  rows.push({
    name: site.name,
    url: site.url,
    score: json.score?.value ?? null,
    grade: json.score?.grade ?? null,
    words: json.stats?.words ?? 0,
    flags: json.flags?.length ?? 0,
  })
}

const date = new Date().toISOString().slice(0, 10)
const outDir = join(root, 'leaderboard')
mkdirSync(outDir, { recursive: true })

const sorted = [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))

const md = `# Leaderboard — ${date}

voxfold ${cliPackageJson.version} · rules ${rulesPackageJson.name}@${rulesPackageJson.version}

Single page per site (\`--crawl\` not yet implemented — see the note at the top of \`run.js\`).

| Rank | Site | Score | Grade | Words | Flags |
|---:|---|---:|---|---:|---:|
${sorted
  .map(
    (r, i) =>
      `| ${i + 1} | [${r.name}](${r.url}) | ${r.score ?? '—'} | ${r.grade ?? '—'} | ${r.words} | ${r.flags} |`,
  )
  .join('\n')}
`

const csv = [
  'rank,name,url,score,grade,words,flags',
  ...sorted.map(
    (r, i) =>
      `${i + 1},"${r.name}",${r.url},${r.score ?? ''},${r.grade ?? ''},${r.words},${r.flags}`,
  ),
].join('\n')

writeFileSync(join(outDir, `${date}.md`), md)
writeFileSync(join(outDir, `${date}.csv`), `${csv}\n`)

console.log(`\nWrote leaderboard/${date}.md and leaderboard/${date}.csv`)
