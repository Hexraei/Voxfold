/**
 * The `voxfold` CLI: lint local files, folders and URLs; --fix; CI score gates.
 *
 * Conventions (config resolution, disable comments, exit codes) deliberately follow ESLint,
 * since that is the tool most developers already know — the goal is zero surprises for anyone
 * who has used a linter before.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import cac from 'cac'
import pc from 'picocolors'
import type { RuleConfigValue } from './config.ts'
import { overridesFor, resolveConfig } from './config.ts'
import { discoverFiles, findGitRoot, formatForPath } from './discover.ts'
import { EXIT_FATAL, EXIT_GATE_FAILED, EXIT_OK } from './exit-codes.ts'
import { FetchError, fetchAndExtract, SPA_SHELL_MESSAGE } from './fetch-url.ts'
import { FORMATTER_NAMES, format, isFormatterName } from './format/index.ts'
import { runInit } from './init.ts'
import { allFlags, fixFile, lintFile, summarize } from './lint-runner.ts'
import {
  addSuppressions,
  loadSuppressions,
  pruneSuppressions,
  SUPPRESSIONS_FILENAME,
  suppressionKeyFor,
} from './suppressions.ts'

const VERSION = '0.0.0'

interface CliFlags {
  fix?: boolean
  fixDryRun?: boolean
  format?: string
  quiet?: boolean
  color?: boolean
  // CAC parses numeric-looking option values as strings unless a default number primes the
  // parser, so these are accepted as either and coerced explicitly at the point of use.
  minScore?: string | number
  minFileScore?: string | number
  config?: string
  configLookup?: boolean
  rule?: string | string[]
  ignorePattern?: string | string[]
  gitignore?: boolean
  suppressAll?: boolean
  suppressRule?: string | string[]
  pruneSuppressions?: boolean
  crawl?: boolean
  maxPages?: string | number
  userAgent?: string
  badge?: string
}

/** Parse a CLI numeric flag, rejecting anything that isn't a finite number. */
function parseNumberFlag(value: string | number | undefined, flagName: string): number | undefined {
  if (value === undefined) return undefined
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) throw new Error(`${flagName} must be a number, got "${value}"`)
  return num
}

function parseInlineRules(raw: string | string[] | undefined): Record<string, RuleConfigValue> {
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]
  const rules: Record<string, RuleConfigValue> = {}
  for (const entry of values) {
    const colon = entry.indexOf(':')
    if (colon === -1) continue
    const id = entry.slice(0, colon).trim()
    const severity = entry.slice(colon + 1).trim()
    if (severity === 'off' || severity === 'warn' || severity === 'error') {
      rules[id] = severity
    }
  }
  return rules
}

function isUrl(pattern: string): boolean {
  return /^https?:\/\//i.test(pattern)
}

function printLine(text: string, quiet: boolean | undefined): void {
  if (!quiet) process.stdout.write(`${text}\n`)
}

export async function run(argv: string[]): Promise<number> {
  const cli = cac('voxfold')

  cli
    .command('[...patterns]', 'Lint files, globs, or URLs')
    .option('--fix', 'Apply mechanical fixes in place')
    .option('--fix-dry-run', 'Show what --fix would change without writing')
    .option('--format <name>', `Output format: ${FORMATTER_NAMES.join('|')}`, {
      default: 'stylish',
    })
    .option('--quiet', 'Suppress stylish output (still sets the exit code)')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .option('--min-score <n>', 'Fail (exit 1) if the project score is below n')
    .option('--min-file-score <n>', 'Fail (exit 1) if any single file scores below n')
    .option('--config <path>', 'Path to a config file, skipping the search')
    .option('--no-config-lookup', 'Do not search for a config file; use defaults')
    .option('--rule <rule:severity>', 'Override one rule, e.g. --rule "em-dash:off"')
    .option('--ignore-pattern <glob>', 'Extra glob(s) to ignore')
    .option('--no-gitignore', 'Do not respect .gitignore')
    .option('--suppress-all', 'Write every current flag to the suppressions file')
    .option(
      '--suppress-rule <id>',
      'Write every current flag for one rule to the suppressions file',
    )
    .option('--prune-suppressions', 'Remove suppressions whose flag no longer exists')
    .option('--crawl', 'With a URL, follow the sitemap or same-origin links')
    .option('--max-pages <n>', 'Maximum pages to crawl', { default: 50 })
    .option('--user-agent <ua>', 'User-Agent header for URL fetches')
    .option('--badge <path>', 'Write a shields.io endpoint badge JSON file')
    .action(async (patterns: string[], flags: CliFlags) => {
      process.exitCode = await lintCommand(patterns, flags)
    })

  cli
    .command('init', 'Detect your framework and write a starter voxfold.config.ts')
    .action(async () => {
      process.exitCode = await initCommand()
    })

  cli.help()
  cli.version(VERSION)

  cli.parse(argv, { run: false })
  await cli.runMatchedCommand()
  return Number(process.exitCode ?? EXIT_OK)
}

async function initCommand(): Promise<number> {
  const cwd = process.cwd()
  const result = await runInit(cwd)

  if (result.configWritten) {
    process.stdout.write(`${pc.green('created')} voxfold.config.ts\n`)
  } else {
    process.stdout.write(`${pc.yellow('skipped')} voxfold.config.ts (already exists)\n`)
  }

  if (result.framework === 'unknown') {
    process.stdout.write(
      '\nNo Vite, Astro or Next.js dependency detected — the CLI still works standalone ' +
        '(`voxfold <path>`), but there is no live-edit overlay to wire in.\n',
    )
    return EXIT_OK
  }

  process.stdout.write(
    `\nDetected ${pc.bold(result.framework)}. For the live-edit dev overlay, install ` +
      `${pc.bold(result.integrationPackage ?? '')} and add it to your config:\n\n` +
      `${result.integrationSnippet}\n\n`,
  )
  return EXIT_OK
}

async function lintCommand(patterns: string[], flags: CliFlags): Promise<number> {
  const cwd = process.cwd()
  const formatterName = flags.format ?? 'stylish'
  if (!isFormatterName(formatterName)) {
    process.stderr.write(
      `Unknown format "${formatterName}". Choose one of: ${FORMATTER_NAMES.join(', ')}\n`,
    )
    return EXIT_FATAL
  }

  const urls = patterns.filter(isUrl)
  const filePatterns = patterns.filter((p) => !isUrl(p))

  if (urls.length > 0 && filePatterns.length > 0) {
    process.stderr.write('voxfold does not mix URLs and file patterns in one run.\n')
    return EXIT_FATAL
  }

  let resolvedConfig: Awaited<ReturnType<typeof resolveConfig>>
  try {
    resolvedConfig = await resolveConfig({
      cwd,
      ...(flags.config ? { configPath: flags.config } : {}),
      noConfigLookup: flags.configLookup === false,
      inlineRules: parseInlineRules(flags.rule),
    })
  } catch (error) {
    process.stderr.write(`Config error: ${(error as Error).message}\n`)
    return EXIT_FATAL
  }

  if (urls.length > 0) {
    return lintUrls(urls, flags, resolvedConfig, formatterName)
  }
  return lintFiles(filePatterns, flags, resolvedConfig, formatterName, cwd)
}

async function lintUrls(
  urls: string[],
  flags: CliFlags,
  resolvedConfig: Awaited<ReturnType<typeof resolveConfig>>,
  formatterName: Parameters<typeof format>[0],
): Promise<number> {
  const userAgent = flags.userAgent ?? `voxfold/${VERSION} (+https://github.com/Hexraei/Voxfold)`

  if (flags.crawl) {
    process.stderr.write('--crawl is not implemented yet; fetching the given URL(s) only.\n')
  }

  const results: Awaited<ReturnType<typeof lintFile>>[] = []
  for (const url of urls) {
    let fetched: Awaited<ReturnType<typeof fetchAndExtract>>
    try {
      fetched = await fetchAndExtract(url, userAgent)
    } catch (error) {
      if (error instanceof FetchError) {
        process.stderr.write(`${error.message}\n`)
        return EXIT_FATAL
      }
      throw error
    }

    if (fetched.isShell) {
      process.stderr.write(`${url}\n  ${SPA_SHELL_MESSAGE}\n`)
      continue
    }

    const { lint } = await import('@voxfold/core')
    const overrides = overridesFor(resolvedConfig.entries, url)
    const result = lint(fetched.document, resolvedConfig.ruleset, {
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    })
    results.push({ file: url, document: fetched.document, result })
  }

  if (results.length === 0) {
    process.stderr.write('No page had content to lint.\n')
    return EXIT_FATAL
  }

  const summary = summarize(results, results[0]!.result.ruleset)
  printLine(format(formatterName, summary, process.cwd()), flags.quiet)
  return gateExitCode(summary, flags)
}

async function lintFiles(
  patterns: string[],
  flags: CliFlags,
  resolvedConfig: Awaited<ReturnType<typeof resolveConfig>>,
  formatterName: Parameters<typeof format>[0],
  cwd: string,
): Promise<number> {
  const ignorePatterns =
    flags.ignorePattern === undefined
      ? []
      : Array.isArray(flags.ignorePattern)
        ? flags.ignorePattern
        : [flags.ignorePattern]

  const files = await discoverFiles({
    cwd,
    patterns,
    useGitignore: flags.gitignore !== false,
    extraIgnores: ignorePatterns,
  })

  if (files.length === 0) {
    process.stderr.write('No lintable files found (looked for .md, .mdx, .html).\n')
    return EXIT_FATAL
  }

  const suppressionsPath = join(findGitRoot(cwd), SUPPRESSIONS_FILENAME)
  const suppressions = await loadSuppressions(suppressionsPath)

  // Always lint with includeSuppressed: true when a suppressions file exists, so a currently
  // suppressed flag still shows up in `results` (marked `.suppressed`, contributing 0 to score)
  // instead of vanishing entirely. Without that, --prune-suppressions could never tell "this
  // suppression's flag still fires, just hidden" apart from "this flag is gone for good" — both
  // look identical (absent) once the engine has already filtered them out.
  //
  // document.uri must equal the suppressions file's key for a file (suppressionKeyFor), since
  // the engine matches suppressions by that string verbatim. Using the raw filesystem path here
  // instead is exactly the mismatch that silently made --suppress-rule a no-op.
  const results = []
  for (const file of files) {
    const fileFormat = formatForPath(file)!
    const overrides = overridesFor(resolvedConfig.entries, file)
    const uri = suppressionKeyFor(suppressionsPath, file)
    const result = await lintFile(file, fileFormat, uri, {
      ruleset: resolvedConfig.ruleset,
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
      ...(suppressions ? { suppressions, includeSuppressed: true } : {}),
    })
    results.push(result)
  }

  if (flags.suppressAll || flags.suppressRule) {
    const entries = allFlags(results).filter(
      ({ flag }) => !flag.suppressed && (flags.suppressAll || flag.ruleId === flags.suppressRule),
    )
    const added = await addSuppressions(suppressionsPath, entries)
    printLine(pc.dim(`Added ${added} suppression(s) to ${SUPPRESSIONS_FILENAME}`), flags.quiet)
    return EXIT_OK
  }

  if (flags.pruneSuppressions) {
    // `allFlags` reports `document.uri` (already the suppressions-file-relative key) as `file`,
    // so this matches pruneSuppressions' own `${file}::rule::hash` keying with no translation.
    // With includeSuppressed above, a still-firing suppressed flag is present here too, so it is
    // correctly kept rather than mistaken for one whose tell disappeared.
    const present = new Set(
      allFlags(results).map(({ file, flag }) => `${file}::${flag.ruleId}::${flag.hash}`),
    )
    const removed = await pruneSuppressions(suppressionsPath, present)
    printLine(
      pc.dim(`Removed ${removed} stale suppression(s) from ${SUPPRESSIONS_FILENAME}`),
      flags.quiet,
    )
  }

  // Suppressed flags have done their job (bookkeeping above); hide them from the report the
  // user actually reads, same as ESLint hides disabled rules' output.
  for (const result of results) {
    result.result.flags = result.result.flags.filter((flag) => !flag.suppressed)
  }

  if (flags.fix || flags.fixDryRun) {
    let totalFixed = 0
    for (const { file, result } of results) {
      const original = await readFile(file, 'utf8')
      const { text, count } = fixFile(original, result)
      if (count === 0) continue
      totalFixed += count
      if (flags.fix) await writeFile(file, text)
    }
    const verb = flags.fix ? 'Fixed' : 'Would fix'
    printLine(pc.dim(`${verb} ${totalFixed} issue(s).`), flags.quiet)
    if (flags.fix) {
      // Re-lint after writing so the printed report and gate reflect the fixed files.
      const refreshed = []
      for (const file of files) {
        const fileFormat = formatForPath(file)!
        const overrides = overridesFor(resolvedConfig.entries, file)
        const uri = suppressionKeyFor(suppressionsPath, file)
        refreshed.push(
          await lintFile(file, fileFormat, uri, {
            ruleset: resolvedConfig.ruleset,
            ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
            ...(suppressions ? { suppressions } : {}),
          }),
        )
      }
      results.splice(0, results.length, ...refreshed)
    }
  }

  const summary = summarize(results, results[0]!.result.ruleset)

  if (flags.badge) {
    await writeBadge(flags.badge, summary)
  }

  printLine(format(formatterName, summary, cwd), flags.quiet)
  return gateExitCode(summary, flags)
}

async function writeBadge(
  path: string,
  summary: Awaited<ReturnType<typeof summarize>>,
): Promise<void> {
  const value = summary.score?.value
  const grade = summary.score?.grade
  const color =
    value === undefined
      ? 'lightgrey'
      : value >= 90
        ? 'brightgreen'
        : value >= 80
          ? 'green'
          : value >= 70
            ? 'yellow'
            : value >= 60
              ? 'orange'
              : 'red'
  const badge = {
    schemaVersion: 1,
    label: 'style',
    message: value === undefined ? 'n/a' : `${value} · ${grade}`,
    color,
  }
  await writeFile(path, `${JSON.stringify(badge)}\n`)
}

function gateExitCode(summary: Awaited<ReturnType<typeof summarize>>, flags: CliFlags): number {
  const hasError = summary.files.some((f) =>
    f.result.flags.some((flag) => flag.severity === 'error'),
  )
  if (hasError) return EXIT_GATE_FAILED

  const minScore = parseNumberFlag(flags.minScore, '--min-score')
  const minFileScore = parseNumberFlag(flags.minFileScore, '--min-file-score')

  if (minScore !== undefined) {
    if (summary.score === null || summary.score.value < minScore) return EXIT_GATE_FAILED
  }
  if (minFileScore !== undefined) {
    for (const { result } of summary.files) {
      if (result.score !== null && result.score.value < minFileScore) return EXIT_GATE_FAILED
    }
  }
  return EXIT_OK
}
