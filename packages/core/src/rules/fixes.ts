/**
 * Fixes and suggestions.
 *
 * A `fix` has exactly one correct result and `--fix` applies it unattended. "utilize" → "use"
 * qualifies. Deleting a word does not always qualify: "In today's fast-paced world, we ship"
 * leaves a dangling comma and a lower-case sentence opening, so the cleanup steps run and their
 * result is checked. If the check fails the fix is DOWNGRADED to a suggestion rather than
 * written, because a linter that mangles a sentence is worse than one that stays quiet.
 *
 * Structural rules never produce either: naming the tell and letting a human rewrite it is the
 * entire point of the tool.
 */

import { normalizeForMatch } from '../text/normalize.ts'
import type { Match } from './match.ts'
import type { CleanupOp, Fix, Rule, Suggestion } from './schema.ts'

/** An edit expressed in flat block coordinates; the writer maps it to source offsets. */
export interface FlatEdit {
  start: number
  end: number
  text: string
}

export interface SuggestionResult {
  label: string
  edits: FlatEdit[]
}

export interface FixResult {
  fix?: FlatEdit[]
  suggestions?: SuggestionResult[]
  /** Set when a fix was demoted because its cleanup could not be verified. */
  downgraded?: boolean
}

const SENTENCE_END = /[.!?]["')\]]?\s*$/
const ARTICLE_BEFORE_VOWEL = /\ba\s+(?=[aeiou])/gi
const ARTICLE_BEFORE_CONSONANT = /\ban\s+(?![aeiou])/gi

/** Apply an edit list to text, for verification. Edits must not overlap. */
export function applyEdits(text: string, edits: readonly FlatEdit[]): string {
  const ordered = [...edits].sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = 0
  for (const edit of ordered) {
    out += text.slice(cursor, edit.start) + edit.text
    cursor = edit.end
  }
  return out + text.slice(cursor)
}

/**
 * Widen a deletion to swallow the whitespace and punctuation left behind, then repair the
 * sentence. Returns the edit plus whether the result still reads as a sentence.
 */
function planDeletion(text: string, match: Match, cleanup: readonly CleanupOp[]): FixResult {
  let start = match.start
  let end = match.end

  if (cleanup.includes('collapse-space')) {
    // Take the whitespace on one side only, so "ships seamlessly with" → "ships with".
    while (end < text.length && /\s/.test(text[end]!)) end++
    if (end >= text.length || /[.,;:!?]/.test(text[end] ?? '')) {
      while (start > 0 && /\s/.test(text[start - 1]!)) start--
    }
  }

  if (cleanup.includes('dangling-comma')) {
    // "In today's fast-paced world, we ship" → drop the comma the opener left behind.
    let after = end
    while (after < text.length && /\s/.test(text[after]!)) after++
    if (text[after] === ',') {
      end = after + 1
      while (end < text.length && /\s/.test(text[end]!)) end++
    }
  }

  let replacement = ''
  // A deletion that swallowed the separator between two words must leave one space behind.
  const needsSpace =
    start > 0 && end < text.length && !/\s/.test(text[start - 1]!) && !/[\s.,;:!?]/.test(text[end]!)
  if (needsSpace) replacement = ' '

  const edits: FlatEdit[] = [{ start, end, text: replacement }]
  let result = applyEdits(text, edits)

  if (cleanup.includes('recapitalize') && start === 0) {
    // Locate the new first letter in the ORIGINAL text: edits are expressed in original
    // coordinates, and the deletion has already shifted every index in `result`.
    const relative = text.slice(end).search(/\p{L}/u)
    if (relative !== -1) {
      const index = end + relative
      const char = text[index]!
      const upper = char.toUpperCase()
      if (upper !== char && upper.length === 1) {
        edits.push({ start: index, end: index + 1, text: upper })
        result = applyEdits(text, edits)
      }
    }
  }

  if (cleanup.includes('fix-article')) {
    const repaired = result
      .replace(ARTICLE_BEFORE_VOWEL, (article) => `${article.trimEnd().slice(0, -1)}an `)
      .replace(ARTICLE_BEFORE_CONSONANT, (article) => `${article.trimEnd().slice(0, -2)}a `)
    if (repaired !== result) {
      // Article repair rewrites arbitrary spans; rather than compute more edits, refuse the
      // automatic fix. The suggestion path still offers the deletion to a human.
      return { suggestions: [{ label: 'delete', edits }], downgraded: true }
    }
  }

  if (!isWellFormed(result, text)) {
    return { suggestions: [{ label: 'delete', edits }], downgraded: true }
  }
  return { fix: edits }
}

/**
 * Sanity checks on a fixed sentence. Deliberately shallow: they catch the damage a deletion
 * actually causes (empty text, doubled or orphaned punctuation, a lost sentence) rather than
 * attempting to judge grammar.
 */
function isWellFormed(result: string, original: string): boolean {
  const trimmed = result.trim()
  if (trimmed.length === 0) return false
  if (/^[.,;:!?]/.test(trimmed)) return false
  if (/\s[,;:]/.test(result)) return false
  if (/[,;:]\s*[.!?]/.test(result)) return false
  if (/,\s*,/.test(result)) return false
  if (/\s{2,}/.test(result.trim())) return false
  // A sentence that ended with punctuation must still end with it.
  if (SENTENCE_END.test(original) && !SENTENCE_END.test(result)) return false
  return true
}

function planReplacement(text: string, match: Match, map: Record<string, string>): FlatEdit[] {
  const key = normalizeForMatch(match.text)
  const replacement = map[key] ?? map['*']
  if (replacement === undefined) return []

  // Preserve the casing of the original word: "Utilize" → "Use", "UTILIZE" → "USE".
  const original = match.text
  let cased = replacement
  if (/^\p{Lu}[\p{Ll}\p{N}'’-]*$/u.test(original)) {
    cased = replacement.charAt(0).toUpperCase() + replacement.slice(1)
  } else if (
    original.length > 1 &&
    original === original.toUpperCase() &&
    /\p{L}/u.test(original)
  ) {
    cased = replacement.toUpperCase()
  }
  void text
  return [{ start: match.start, end: match.end, text: cased }]
}

function planSuggestions(
  text: string,
  match: Match,
  suggestions: readonly Suggestion[],
): SuggestionResult[] {
  return suggestions.map((suggestion) => {
    const edits: FlatEdit[] = [{ start: match.start, end: match.end, text: suggestion.replace }]
    if (suggestion.recapitalize) {
      // Replacing "—" with ". " starts a new sentence, so the next word is capitalized.
      const after = match.end
      const letter = text.slice(after).search(/\p{L}/u)
      if (letter !== -1) {
        const index = after + letter
        const char = text[index]!
        const upper = char.toUpperCase()
        if (upper !== char && upper.length === 1) {
          edits.push({ start: index, end: index + 1, text: upper })
        }
      }
    }
    return { label: suggestion.label, edits }
  })
}

/** Compute the fix and/or suggestions a rule offers for one match. */
export function planFix(rule: Rule, text: string, match: Match): FixResult {
  const result: FixResult = {}

  if (rule.kind === 'mechanical' && rule.fix) {
    const planned = planFixOnly(rule.fix, text, match)
    if (planned.fix) result.fix = planned.fix
    if (planned.suggestions) result.suggestions = planned.suggestions
    if (planned.downgraded) result.downgraded = true
  }

  if (rule.suggest && rule.suggest.length > 0) {
    result.suggestions = [
      ...(result.suggestions ?? []),
      ...planSuggestions(text, match, rule.suggest),
    ]
  }
  return result
}

function planFixOnly(fix: Fix, text: string, match: Match): FixResult {
  if (fix.type === 'replace') {
    const edits = planReplacement(text, match, fix.map)
    return edits.length > 0 ? { fix: edits } : {}
  }
  return planDeletion(text, match, fix.cleanup ?? ['collapse-space'])
}
