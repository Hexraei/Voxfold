/**
 * Config: flat-config style, following ESLint's current conventions on purpose — anyone who has
 * configured ESLint already knows the shape (an array of objects, each scoping `files`/`ignores`
 * to a subset of rule overrides).
 *
 * Resolution order (first found wins), searched upward from cwd:
 *   voxfold.config.ts / .mts / .js / .mjs   (TS loaded via jiti, no build step required)
 *   .voxfold.yaml / .yml / .json            (for non-JS repos: Hugo, Sphinx, plain docs)
 * `--config <path>` overrides the search. `--no-config-lookup` skips it and uses defaults.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { RuleOverride, RuleOverrides, RuleSet, Severity } from '@voxfold/core'
import { recommended } from '@voxfold/rules-recommended'
// micromatch is CJS-only with named properties on its export object, not real ESM named
// exports; importing the default and destructuring is the reliable interop path.
import micromatch from 'micromatch'

const { isMatch } = micromatch

import { parse as parseYaml } from 'yaml'

/** One rule's config value: a bare severity, or [severity, options]. */
export type RuleConfigValue = Severity | [Severity, { weight?: number }]

export interface ConfigEntry {
  /** Globs this entry applies to. Omitted means "all files". */
  files?: string[]
  /** Globs to exclude. A bare `ignores` with no `files` ignores project-wide. */
  ignores?: string[]
  rules?: Record<string, RuleConfigValue>
  /** Additional rule sets to merge in, e.g. from an npm rule pack (`voxfold-rules-*`). */
  plugins?: RuleSet[]
  settings?: {
    jsx?: { proseProps?: string[] }
    html?: { skipSelectors?: string[] }
    minWords?: number
  }
}

export type VoxfoldConfig = ConfigEntry[]

export function defineConfig(entries: VoxfoldConfig): VoxfoldConfig {
  return entries
}

export interface ResolvedConfig {
  /** Merged ruleset: recommended plus any plugin rule sets, de-duplicated by id (last wins). */
  ruleset: RuleSet
  entries: ConfigEntry[]
  /** Absolute path of the config file used, or undefined when defaults applied. */
  configPath?: string
  settings: Required<NonNullable<ConfigEntry['settings']>>
}

const CONFIG_FILENAMES = [
  'voxfold.config.ts',
  'voxfold.config.mts',
  'voxfold.config.js',
  'voxfold.config.mjs',
]
const RC_FILENAMES = ['.voxfold.yaml', '.voxfold.yml', '.voxfold.json']

/** Search upward from `startDir` for the first config file that exists. */
function findConfigFile(startDir: string): string | undefined {
  let dir = resolve(startDir)
  for (;;) {
    for (const name of [...CONFIG_FILENAMES, ...RC_FILENAMES]) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

async function loadConfigFile(path: string): Promise<VoxfoldConfig> {
  if (path.endsWith('.json') || path.endsWith('.yaml') || path.endsWith('.yml')) {
    const text = await readFile(path, 'utf8')
    const data = path.endsWith('.json') ? JSON.parse(text) : parseYaml(text)
    // The rc formats take one entry's worth of fields directly, not an array.
    return [data]
  }

  // jiti loads TS/ESM/CJS interchangeably without a build step, the same trick ESLint's flat
  // config loader and most modern CLI tools use for user config files.
  const { createJiti } = await import('jiti')
  const jiti = createJiti(import.meta.url, { interopDefault: true })
  const loaded = (await jiti.import(path, { default: true })) as VoxfoldConfig
  return loaded
}

/** Compile [severity, {weight}] | severity into a RuleOverride, or 'off' as a special case. */
function normalizeRuleValue(value: RuleConfigValue): RuleOverride {
  if (Array.isArray(value)) {
    const [severity, options] = value
    return { severity, ...(options?.weight !== undefined ? { weight: options.weight } : {}) }
  }
  return { severity: value }
}

/** Merge every matching entry's `rules` into one override map, later entries winning. */
export function overridesFor(entries: readonly ConfigEntry[], filePath: string): RuleOverrides {
  const overrides: RuleOverrides = {}
  for (const entry of entries) {
    if (!entryApplies(entry, filePath)) continue
    for (const [ruleId, value] of Object.entries(entry.rules ?? {})) {
      overrides[ruleId] = { ...overrides[ruleId], ...normalizeRuleValue(value) }
    }
  }
  return overrides
}

function entryApplies(entry: ConfigEntry, filePath: string): boolean {
  if (entry.ignores && matchesAny(entry.ignores, filePath) && !entry.files) return false
  if (entry.files && !matchesAny(entry.files, filePath)) return false
  return true
}

function matchesAny(patterns: readonly string[], filePath: string): boolean {
  return patterns.some((pattern) => isMatch(filePath, pattern, { dot: true }))
}

/** Merge a base ruleset with plugin rule sets, later plugins overriding earlier ones by id. */
function mergeRulesets(base: RuleSet, plugins: readonly RuleSet[]): RuleSet {
  if (plugins.length === 0) return base
  const byId = new Map(base.rules.map((rule) => [rule.id, rule]))
  for (const plugin of plugins) {
    for (const rule of plugin.rules) byId.set(rule.id, rule)
  }
  const pluginTag = plugins.map((p) => `${p.name}@${p.version}`).join('+')
  return { name: `${base.name}+${pluginTag}`, version: base.version, rules: [...byId.values()] }
}

export async function resolveConfig(options: {
  cwd: string
  configPath?: string
  noConfigLookup?: boolean
  inlineRules?: Record<string, RuleConfigValue>
}): Promise<ResolvedConfig> {
  const configPath = options.noConfigLookup
    ? undefined
    : (options.configPath ?? findConfigFile(options.cwd))

  const entries = configPath ? await loadConfigFile(configPath) : []
  if (options.inlineRules && Object.keys(options.inlineRules).length > 0) {
    entries.push({ rules: options.inlineRules })
  }

  const plugins = entries.flatMap((entry) => entry.plugins ?? [])
  const ruleset = mergeRulesets(recommended, plugins)

  const settings: Required<NonNullable<ConfigEntry['settings']>> = {
    jsx: { proseProps: [] },
    html: { skipSelectors: [] },
    minWords: 80,
  }
  for (const entry of entries) {
    if (entry.settings?.jsx?.proseProps) settings.jsx.proseProps = entry.settings.jsx.proseProps
    if (entry.settings?.html?.skipSelectors) {
      settings.html.skipSelectors = entry.settings.html.skipSelectors
    }
    if (entry.settings?.minWords !== undefined) settings.minWords = entry.settings.minWords
  }

  return { ruleset, entries, settings, ...(configPath ? { configPath } : {}) }
}
