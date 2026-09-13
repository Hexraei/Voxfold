/**
 * The rule format.
 *
 * Rules are data, the engine is code. A rule says what to look for, how much it weighs and what
 * to tell the user; it never contains matching logic. That keeps rule curation (a taste
 * judgement) separate from engine correctness (a code judgement), and it lets the same rule file
 * drive the CLI, the browser overlay and the GitHub Action identically.
 *
 * Authored as YAML, compiled to JSON at build time, validated against `rule.schema.json`.
 */

import type { BlockKind, Format } from '../types.ts'

export type RuleKind = 'mechanical' | 'structural'
export type Severity = 'off' | 'warn' | 'error'

export type RuleCategory =
  | 'punctuation'
  | 'plain-words'
  | 'intensifier'
  | 'inanimate-adverb'
  | 'buzzword'
  | 'opener-closer'
  | 'construction'
  | 'markdown'

/** Window a density threshold is counted over. */
export type DensityScope = 'sentence' | 'block' | 'document'

export interface DensitySpec {
  per: DensityScope
  /** Occurrences in the window at which the tell counts at full weight. */
  threshold: number
  /**
   * Score multiplier for occurrences below the threshold. Every occurrence is still flagged;
   * a lone em dash simply costs almost nothing.
   */
  below: number
}

/** Match literal words, with optional inflected and regional spellings. */
export interface WordsMatcher {
  type: 'words'
  words: string[]
  /** Require the word to carry this tag, e.g. `leverage` only as a VERB. */
  tag?: string
}

/** Match a multi-word phrase, whitespace-insensitive. */
export interface PhrasesMatcher {
  type: 'phrases'
  phrases: string[]
}

/** Match literal characters, e.g. em dashes. */
export interface CharsMatcher {
  type: 'chars'
  chars: string[]
}

/** Escape hatch for shapes the token DSL cannot express. Applied to normalized flat text. */
export interface RegexMatcher {
  type: 'regex'
  pattern: string
  flags?: string
}

/** One position in a token pattern. */
export interface TokenPatternStep {
  /** Literal surface form(s), compared normalized. */
  word?: string[]
  /** Base form(s), e.g. `sync` matches "syncs". */
  lemma?: string[]
  /** Required tag, e.g. `ADV`. */
  tag?: string
  /** Word must be animate / inanimate, for subject-sensitive rules. */
  animate?: boolean
  optional?: boolean
  /** Match one or more of this step. */
  repeat?: boolean
  /** Invert this step: match any token that does NOT satisfy it. */
  not?: boolean
}

export interface TokensMatcher {
  type: 'tokens'
  tokens: TokenPatternStep[]
}

/** Invoke a named built-in detector, parameterized by data. */
export interface DetectorMatcher {
  type: 'detector'
  detector: string
  params?: Record<string, unknown>
}

export type Matcher =
  | WordsMatcher
  | PhrasesMatcher
  | CharsMatcher
  | RegexMatcher
  | TokensMatcher
  | DetectorMatcher

/** A replacement applied to the matched text. */
export interface ReplaceFix {
  type: 'replace'
  /** Matched (normalized) text → replacement. `*` is a catch-all for single-target rules. */
  map: Record<string, string>
}

/** Delete the match and tidy up around the hole. */
export interface DeleteFix {
  type: 'delete'
  cleanup?: CleanupOp[]
}

/**
 * Repairs applied after a deletion, each of which must leave a well-formed sentence or the fix
 * is downgraded to a suggestion rather than written.
 */
export type CleanupOp = 'collapse-space' | 'dangling-comma' | 'recapitalize' | 'fix-article'

export type Fix = ReplaceFix | DeleteFix

/** A choice offered to a human. Never applied by `--fix`. */
export interface Suggestion {
  label: string
  replace: string
  recapitalize?: boolean
}

export interface RuleExamples {
  /** Text that must produce a flag. Compiled into fixtures. */
  flag: string[]
  /** Text that must NOT produce a flag. Compiled into fixtures. */
  pass: string[]
}

export interface Rule {
  id: string
  lang: 'en'
  kind: RuleKind
  category: RuleCategory
  /** Contribution to the score per occurrence, before density and block weighting. */
  weight: number
  severity: Severity
  message: string
  /** One line on why this reads as a tell and what to do instead. */
  docs: string
  match: Matcher
  appliesTo?: BlockKind[]
  skipIn?: BlockKind[]
  formats?: Format[]
  density?: DensitySpec
  /** Per-block-kind density overrides, e.g. headings are too short to judge fairly. */
  densityOverrides?: Partial<Record<BlockKind, Partial<DensitySpec>>>
  /** Mechanical rules only: a single correct edit. */
  fix?: Fix
  /** Choices a human picks between. Structural rules never have these either. */
  suggest?: Suggestion[]
  examples: RuleExamples
}

/** A rule set as shipped: rules plus the identity that makes scores reproducible. */
export interface RuleSet {
  name: string
  /** Semver of the rule data itself, independent of package versions. */
  version: string
  rules: Rule[]
}

/** Rule severities and weights overridden by user config. */
export interface RuleOverride {
  severity?: Severity
  weight?: number
}

export type RuleOverrides = Record<string, RuleOverride>
