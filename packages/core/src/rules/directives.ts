/**
 * Disable comments and the suppressions file.
 *
 * Adapters parse the format's own comment syntax into `Directive`s; deciding what a directive
 * silences happens here, once, so every format behaves identically. Conventions follow ESLint
 * because developers already know them.
 *
 *   <!-- voxfold-disable-next-line em-dash -->
 *   {\/* voxfold-disable *\/}   … {\/* voxfold-enable *\/}
 */

import type { Directive, SourceRange } from '../types.ts'

/** Parsed form of a `voxfold-*` comment body, or undefined when it is not one. */
export function parseDirectiveComment(
  body: string,
  src: SourceRange,
  line: number,
): Directive | undefined {
  const match = /voxfold-(disable-next-line|disable-line|disable|enable)\b([^*]*)/.exec(body)
  if (!match) return undefined

  const type = match[1] as Directive['type']
  const rules = (match[2] ?? '')
    .split(/[\s,]+/)
    .map((rule) => rule.trim())
    .filter((rule) => rule.length > 0 && !rule.startsWith('--'))

  return { type, rules, src, line }
}

export interface SuppressionEntry {
  rule: string
  /** sha1 of rule id + normalized sentence text; survives the text moving lines. */
  hash: string
  note?: string
}

export interface SuppressionsFile {
  version: 1
  files: Record<string, SuppressionEntry[]>
}

export interface DirectiveState {
  /** Rules disabled for the whole remainder of the file, by source offset. */
  ranges: Array<{ from: number; to: number; rules: string[] }>
  /** Rules disabled on specific 1-based lines. */
  lines: Map<number, string[]>
}

/**
 * Reduce a document's directives into a lookup usable per flag.
 *
 * An unmatched `disable` runs to the end of the file, matching ESLint: the author wrote it on
 * purpose, and silently re-enabling would surprise them.
 */
export function resolveDirectives(
  directives: readonly Directive[],
  sourceLength: number,
): DirectiveState {
  const ranges: DirectiveState['ranges'] = []
  const lines = new Map<number, string[]>()
  const open: Array<{ from: number; rules: string[] }> = []

  const addLine = (line: number, rules: string[]): void => {
    const existing = lines.get(line)
    if (!existing) {
      lines.set(line, [...rules])
      return
    }
    // An empty rule list means "all rules"; it absorbs any specific list.
    if (existing.length === 0 || rules.length === 0) lines.set(line, [])
    else lines.set(line, [...existing, ...rules])
  }

  for (const directive of [...directives].sort((a, b) => a.src.start - b.src.start)) {
    switch (directive.type) {
      case 'disable-next-line':
        addLine(directive.line + 1, directive.rules)
        break
      case 'disable-line':
        addLine(directive.line, directive.rules)
        break
      case 'disable':
        open.push({ from: directive.src.end, rules: directive.rules })
        break
      case 'enable': {
        const opened = open.pop()
        if (opened) ranges.push({ from: opened.from, to: directive.src.start, rules: opened.rules })
        break
      }
    }
  }

  for (const opened of open)
    ranges.push({ from: opened.from, to: sourceLength, rules: opened.rules })
  return { ranges, lines }
}

/** True when `ruleId` is silenced at this source position / line. */
export function isDisabled(
  state: DirectiveState,
  ruleId: string,
  offset: number,
  line: number,
): boolean {
  const covers = (rules: readonly string[]): boolean => rules.length === 0 || rules.includes(ruleId)

  const lineRules = state.lines.get(line)
  if (lineRules && covers(lineRules)) return true

  for (const range of state.ranges) {
    if (offset >= range.from && offset < range.to && covers(range.rules)) return true
  }
  return false
}

/** Look up a flag in the suppressions file. */
export function isSuppressed(
  file: SuppressionsFile | undefined,
  uri: string,
  ruleId: string,
  hash: string,
): boolean {
  const entries = file?.files[uri]
  if (!entries) return false
  return entries.some((entry) => entry.rule === ruleId && entry.hash === hash)
}
