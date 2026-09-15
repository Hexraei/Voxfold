/**
 * Base-vs-head comparison. Flags are matched by `path::ruleId::hash` — the same identity
 * `voxfold-suppressions.json` keys on (rule id + normalized surrounding sentence, via
 * `Flag.hash`), not raw offsets, since offsets shift under any unrelated edit in the file.
 */

import type { Flag } from '@voxfold/core'
import type { FlagWithFile, ProjectSummary } from './lint.ts'
import { allFlags } from './lint.ts'

function identity(path: string, flag: Flag): string {
  return `${path}::${flag.ruleId}::${flag.hash}`
}

export interface Delta {
  scoreBefore: number | null
  scoreAfter: number | null
  scoreDelta: number | null
  newFlags: FlagWithFile[]
  fixedFlags: FlagWithFile[]
  categoryCounts: Map<string, number>
}

export function computeDelta(base: ProjectSummary, head: ProjectSummary): Delta {
  const baseFlags = allFlags(base.files)
  const headFlags = allFlags(head.files)

  const baseIds = new Set(baseFlags.map(({ path, flag }) => identity(path, flag)))
  const headIds = new Set(headFlags.map(({ path, flag }) => identity(path, flag)))

  const newFlags = headFlags.filter(({ path, flag }) => !baseIds.has(identity(path, flag)))
  const fixedFlags = baseFlags.filter(({ path, flag }) => !headIds.has(identity(path, flag)))

  const categoryCounts = new Map<string, number>()
  for (const { flag } of headFlags) {
    categoryCounts.set(flag.category, (categoryCounts.get(flag.category) ?? 0) + 1)
  }

  const scoreBefore = base.score?.value ?? null
  const scoreAfter = head.score?.value ?? null
  const scoreDelta = scoreBefore !== null && scoreAfter !== null ? scoreAfter - scoreBefore : null

  return { scoreBefore, scoreAfter, scoreDelta, newFlags, fixedFlags, categoryCounts }
}
