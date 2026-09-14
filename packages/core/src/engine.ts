/**
 * The engine: ProseDocument + RuleSet → flags + score.
 *
 * Pure and deterministic. No file I/O, no network, no clock, no locale-sensitive calls, so the
 * CLI, the browser overlay and the GitHub Action all produce the same numbers for the same text.
 */

import { mapOf } from './block-builder.ts'
import type { MappedRange } from './offset-map.ts'
import { type DetectorContext, getDetector } from './rules/detectors.ts'
import type { SuppressionsFile } from './rules/directives.ts'
import {
  type DirectiveState,
  isDisabled,
  isSuppressed,
  resolveDirectives,
} from './rules/directives.ts'
import { applyEdits, planFix } from './rules/fixes.ts'
import {
  createMatchContext,
  dedupe,
  type Match,
  type MatchContext,
  runMatcher,
} from './rules/match.ts'
import type { DensitySpec, Rule, RuleOverrides, RuleSet, Severity } from './rules/schema.ts'
import { type SourceEdit, translateFixStrict } from './rules/source-edits.ts'
import { type Calibration, computeScore, PLACEHOLDER_CALIBRATION, type Score } from './score.ts'
import { type Sentence, splitSentences } from './text/sentences.ts'
import { defaultTagger, type Tagger } from './text/tagger.ts'
import { countWords, tokenize } from './text/tokenize.ts'
import type { Block, ProseDocument, SourceRange } from './types.ts'

export interface Flag {
  ruleId: string
  kind: Rule['kind']
  category: Rule['category']
  severity: Exclude<Severity, 'off'>
  message: string
  docs: string
  blockId: string
  /** Range within the block's flat text. */
  flatRange: [number, number]
  /** Source ranges, one per segment the match spans. Empty for DOM-only documents. */
  sourceRanges: SourceRange[]
  /** The matched text, as it appears. */
  text: string
  /** Score cost of this occurrence, after density and block weighting. */
  contribution: number
  /** True when this occurrence sat in a window at or over the rule's density threshold. */
  dense: boolean
  /** Whether every source range behind this flag can be edited in place. */
  editable: boolean
  /**
   * A single correct fix, already translated to SOURCE-file offsets (never flat-block offsets).
   * Absent when the rule has no fix, or when the fix could not be expressed as a clean source
   * edit (e.g. it would touch a locked segment) — in that case it is offered as a suggestion
   * instead, never partially applied.
   */
  fix?: SourceEdit[]
  /** Choices a human picks between, each already translated to source-file offsets. */
  suggestions?: Array<{ label: string; edits: SourceEdit[] }>
  /** Stable identity for suppressions: rule id + normalized surrounding sentence. */
  hash: string
  suppressed?: 'inline' | 'file'
}

export interface LintOptions {
  overrides?: RuleOverrides
  suppressions?: SuppressionsFile
  calibration?: Calibration
  tagger?: Tagger
  /** Include flags silenced by a directive or the suppressions file. Default false. */
  includeSuppressed?: boolean
}

export interface LintResult {
  flags: Flag[]
  score: Score | null
  stats: {
    words: number
    blocks: number
    /** Total contribution, so callers can aggregate scores across files. */
    contribution: number
  }
  ruleset: string
}

interface PreparedBlock {
  block: Block
  context: MatchContext
  sentences: Sentence[]
  words: number
  line: number
}

/** FNV-1a: a small, stable, dependency-free hash. Identity only, never security. */
function hash(text: string): string {
  let value = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value.toString(16).padStart(8, '0')
}

/** 1-based line number of a source offset. */
function lineAt(source: string | undefined, offset: number): number {
  if (!source) return 1
  let line = 1
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line++
  }
  return line
}

function severityOf(rule: Rule, overrides: RuleOverrides | undefined): Severity {
  return overrides?.[rule.id]?.severity ?? rule.severity
}

function weightOf(rule: Rule, overrides: RuleOverrides | undefined): number {
  return overrides?.[rule.id]?.weight ?? rule.weight
}

function appliesToBlock(rule: Rule, block: Block, format: ProseDocument['format']): boolean {
  if (rule.formats && !rule.formats.includes(format)) return false
  if (rule.appliesTo && !rule.appliesTo.includes(block.kind)) return false
  if (rule.skipIn?.includes(block.kind)) return false
  return true
}

/** Density spec for this rule in this block kind, after per-kind overrides. */
function densityFor(rule: Rule, block: Block): DensitySpec | undefined {
  if (!rule.density) return undefined
  const override = rule.densityOverrides?.[block.kind]
  return override ? { ...rule.density, ...override } : rule.density
}

/** Window key for a match, used to count occurrences for density. */
function windowKey(
  spec: DensitySpec,
  blockId: string,
  sentences: readonly Sentence[],
  match: Match,
): string {
  if (spec.per === 'document') return 'document'
  if (spec.per === 'block') return blockId
  const sentence = sentences.find((s) => match.start >= s.start && match.start < s.end)
  return `${blockId}:${sentence?.startToken ?? -1}`
}

/** The sentence containing a match, used for the suppression hash. */
function sentenceTextAt(prepared: PreparedBlock, match: Match): string {
  const sentence = prepared.sentences.find((s) => match.start >= s.start && match.start < s.end)
  return (sentence?.text ?? prepared.block.text).replace(/\s+/g, ' ').trim()
}

function prepare(document: ProseDocument, tagger: Tagger): PreparedBlock[] {
  return document.blocks.map((block) => {
    const tokens = tokenize(block.text)
    const tagged = tagger.tag(block.text, tokens)
    const sentences = splitSentences(block.text, tokens)
    const map = mapOf(block)
    const firstSource = map.toSource(0, 'start')
    return {
      block,
      context: createMatchContext(block.text, tokens, tagged),
      sentences,
      words: countWords(tokens),
      line: lineAt(document.source, firstSource ?? 0),
    }
  })
}

function runRule(rule: Rule, prepared: PreparedBlock): Match[] {
  if (rule.match.type === 'detector') {
    const detector = getDetector(rule.match.detector)
    if (!detector) throw new Error(`unknown detector "${rule.match.detector}" in rule "${rule.id}"`)
    const context: DetectorContext = {
      ...prepared.context,
      block: prepared.block,
      sentences: prepared.sentences,
    }
    return dedupe(detector(context, rule.match.params ?? {}))
  }
  return dedupe(runMatcher(prepared.context, rule.match))
}

/** Lint one document. */
export function lint(
  document: ProseDocument,
  ruleset: RuleSet,
  options: LintOptions = {},
): LintResult {
  const tagger = options.tagger ?? defaultTagger
  const calibration = options.calibration ?? PLACEHOLDER_CALIBRATION
  const rulesetId = `${ruleset.name}@${ruleset.version}+${tagger.id}`

  const prepared = prepare(document, tagger)
  const directiveState: DirectiveState = resolveDirectives(
    document.directives,
    document.source?.length ?? Number.MAX_SAFE_INTEGER,
  )

  interface Pending {
    rule: Rule
    prepared: PreparedBlock
    match: Match
    windowKey: string
    spec?: DensitySpec
  }

  const pending: Pending[] = []
  const windowCounts = new Map<string, number>()

  for (const rule of ruleset.rules) {
    if (severityOf(rule, options.overrides) === 'off') continue

    for (const block of prepared) {
      if (!appliesToBlock(rule, block.block, document.format)) continue

      const spec = densityFor(rule, block.block)
      for (const match of runRule(rule, block)) {
        const key = spec
          ? `${rule.id}:${windowKey(spec, block.block.id, block.sentences, match)}`
          : ''
        if (spec) windowCounts.set(key, (windowCounts.get(key) ?? 0) + 1)
        pending.push({ rule, prepared: block, match, windowKey: key, ...(spec ? { spec } : {}) })
      }
    }
  }

  const flags: Flag[] = []
  let totalContribution = 0

  for (const item of pending) {
    const { rule, prepared: block, match, spec } = item
    const severity = severityOf(rule, options.overrides) as Exclude<Severity, 'off'>
    const weight = weightOf(rule, options.overrides)

    const count = spec ? (windowCounts.get(item.windowKey) ?? 0) : 0
    const dense = spec ? count >= spec.threshold : false
    const densityFactor = spec ? (dense ? 1 : spec.below) : 1
    const contribution = weight * densityFactor * block.block.context.weight

    const map = mapOf(block.block)
    const ranges: MappedRange[] = map.toSourceRanges(match.start, match.end)
    const sourceRanges = ranges.map(({ start, end }) => ({ start, end }))
    const editable = ranges.length > 0 && ranges.every((range) => range.editable)

    const sentenceText = sentenceTextAt(block, match)
    const flagHash = hash(`${rule.id} ${sentenceText}`)

    const line = lineAt(document.source, sourceRanges[0]?.start ?? 0)
    const disabled = isDisabled(directiveState, rule.id, sourceRanges[0]?.start ?? 0, line)
    const suppressedInFile = isSuppressed(options.suppressions, document.uri, rule.id, flagHash)
    const suppressed = disabled ? 'inline' : suppressedInFile ? 'file' : undefined

    if (suppressed && !options.includeSuppressed) continue

    const planned = planFix(rule, block.block.text, match)
    // Translate from flat-block coordinates (where planFix computed them, since Match itself is
    // in that space) to source-file coordinates. Both use translateFixStrict: a fix or
    // suggestion is an atomic edit list, and applying only some of its edits (say, the
    // replacement but not the recapitalize that must go with it) would corrupt the file just as
    // surely as applying it at the wrong offset. Refused outright, never partially applied.
    const fix = planned.fix ? translateFixStrict(map, planned.fix) : undefined
    const suggestions = planned.suggestions
      ?.map((suggestion) => {
        const edits = translateFixStrict(map, suggestion.edits)
        return edits ? { label: suggestion.label, edits } : undefined
      })
      .filter(
        (suggestion): suggestion is { label: string; edits: SourceEdit[] } =>
          suggestion !== undefined,
      )
    const message = dense && spec ? `${rule.message} (${count} in this ${spec.per})` : rule.message

    const flag: Flag = {
      ruleId: rule.id,
      kind: rule.kind,
      category: rule.category,
      severity,
      message,
      docs: rule.docs,
      blockId: block.block.id,
      flatRange: [match.start, match.end],
      sourceRanges,
      text: match.text,
      contribution: suppressed ? 0 : contribution,
      dense,
      editable,
      hash: flagHash,
      ...(fix ? { fix } : {}),
      ...(suggestions && suggestions.length > 0 ? { suggestions } : {}),
      ...(suppressed ? { suppressed } : {}),
    }
    flags.push(flag)
    if (!suppressed) totalContribution += contribution
  }

  // Stable order: by block, then position, then rule id. Never depends on rule evaluation order.
  const blockOrder = new Map(document.blocks.map((block, index) => [block.id, index]))
  flags.sort(
    (a, b) =>
      (blockOrder.get(a.blockId) ?? 0) - (blockOrder.get(b.blockId) ?? 0) ||
      a.flatRange[0] - b.flatRange[0] ||
      a.flatRange[1] - b.flatRange[1] ||
      (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0),
  )

  const words = prepared.reduce((sum, block) => sum + block.words, 0)
  const score = computeScore(
    { contribution: totalContribution, words, ruleset: rulesetId },
    calibration,
  )

  return {
    flags,
    score,
    stats: { words, blocks: document.blocks.length, contribution: totalContribution },
    ruleset: rulesetId,
  }
}

/**
 * Apply every fix in a lint result to the document's SOURCE text (the same string passed to the
 * adapter's `extract`, i.e. `document.source` / the raw file contents) — never to a block's flat
 * text. `Flag.fix` is already translated to source-file offsets by `lint`, so this is a plain
 * apply: no re-derivation of positions happens here, which is deliberate, since the offset
 * translation is exactly the step that is easy to get wrong (see `rules/source-edits.ts`).
 *
 * Used by `--fix` and by tests; for a multi-file project, call this once per file with that
 * file's own flags (a flag belongs to exactly one document via `blockId`/`document.uri`).
 */
export function applyFixes(text: string, flags: readonly Flag[]): string {
  const edits = flags.flatMap((flag) => flag.fix ?? [])
  // Longest match first at a given position: "in order to" should win over "order", since the
  // more specific rule is the one that understood the phrase.
  const sorted = [...edits].sort((a, b) => a.start - b.start || b.end - a.end)

  // Overlapping fixes are then dropped rather than merged: two rules rewriting the same span
  // cannot both be right, and guessing which wins is exactly the kind of silent damage to avoid.
  const safe: SourceEdit[] = []
  for (const edit of sorted) {
    const previous = safe[safe.length - 1]
    if (previous && edit.start < previous.end) continue
    safe.push(edit)
  }
  return applyEdits(text, safe)
}
