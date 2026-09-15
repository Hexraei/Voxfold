/**
 * Orchestration, factored out of index.ts so tests can call it directly with an injected
 * Octokit and controlled inputs instead of going through the real @actions/core env-var
 * boundary and a real network client.
 */

import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { annotationsInDiff, formatAnnotation } from './annotate.ts'
import { buildBadge } from './badge.ts'
import { renderComment } from './comment.ts'
import { computeDelta } from './delta.ts'
import { discoverFiles } from './discover.ts'
import { formatForPath } from './format.ts'
import { gatePasses } from './gate.ts'
import { changedFiles, type DiffHunk, diffHunks, mergeBase, showFile } from './git.ts'
import { lintText, summarize } from './lint.ts'
import type { OctokitLike } from './sticky-comment.ts'
import { upsertStickyComment } from './sticky-comment.ts'

export interface RunInputs {
  cwd: string
  paths: string[]
  minScore?: number
  minFileScore?: number
  comment: boolean
  annotations: boolean
  badge: boolean
  baseRef?: string
  headRef?: string
  isPullRequest: boolean
  isDefaultBranchPush: boolean
  repo: { owner: string; repo: string }
  issueNumber?: number
}

export interface Logger {
  warning: (msg: string) => void
  notice: (msg: string) => void
  setOutput: (name: string, value: string) => void
  setFailed: (msg: string) => void
}

export interface RunResult {
  passed: boolean
  scoreValue: number | null
  badgeJson?: string
}

export async function runAction(
  inputs: RunInputs,
  octokit: OctokitLike | undefined,
  log: Logger,
): Promise<RunResult> {
  const headFiles = await discoverFiles(inputs.cwd, inputs.paths)
  const relPaths = headFiles.map((f) => relative(inputs.cwd, f).split('\\').join('/'))

  const headResults = await Promise.all(
    headFiles.map(async (file, i) => {
      const format = formatForPath(file)!
      const text = await readFile(file, 'utf8')
      return lintText(relPaths[i]!, format, text)
    }),
  )
  const headSummary = summarize(headResults)

  let baseSummary = summarize([])
  let hunksByFile = new Map<string, DiffHunk[]>()

  if (inputs.isPullRequest && inputs.baseRef && inputs.headRef) {
    const base = await mergeBase(inputs.cwd, inputs.baseRef, inputs.headRef)
    const changed = new Set(await changedFiles(inputs.cwd, base, inputs.headRef))
    const inScopeChanged = relPaths.filter((p) => changed.has(p))

    const baseResults = []
    for (const relPath of inScopeChanged) {
      const format = formatForPath(relPath)
      if (!format) continue
      const text = await showFile(inputs.cwd, base, relPath)
      if (text === undefined) continue // file didn't exist on base (newly added)
      baseResults.push(await lintText(relPath, format, text))
    }
    baseSummary = summarize(baseResults)

    hunksByFile = await diffHunks(inputs.cwd, base, inputs.headRef, inScopeChanged)
  }

  const delta = computeDelta(baseSummary, headSummary)

  if (inputs.annotations) {
    const annotations = annotationsInDiff(headResults, hunksByFile)
    // ::warning/::error workflow commands are plain stdout lines the runner parses itself —
    // @actions/core's warning()/error() helpers cover the common case but don't accept a
    // pre-built "file=...,line=...,title=..." command string, so these are written directly.
    for (const a of annotations) process.stdout.write(`${formatAnnotation(a)}\n`)
  }

  if (headSummary.score) {
    log.notice(`voxfold score: ${headSummary.score.value}/100 (${headSummary.score.grade})`)
  }

  if (inputs.comment && octokit && inputs.isPullRequest && inputs.issueNumber !== undefined) {
    const body = renderComment(headSummary, delta)
    await upsertStickyComment(
      octokit,
      inputs.repo.owner,
      inputs.repo.repo,
      inputs.issueNumber,
      body,
    )
  }

  let badgeJson: string | undefined
  if (inputs.badge && inputs.isDefaultBranchPush) {
    badgeJson = JSON.stringify(buildBadge(headSummary))
    log.setOutput('badge-json', badgeJson)
  }

  const passed = gatePasses(headSummary, inputs.minScore, inputs.minFileScore)
  log.setOutput('score', String(headSummary.score?.value ?? ''))
  log.setOutput('grade', headSummary.score?.grade ?? '')
  log.setOutput('new-flags', String(delta.newFlags.length))
  log.setOutput('fixed-flags', String(delta.fixedFlags.length))
  log.setOutput('passed', String(passed))

  if (!passed) {
    log.setFailed('Voxfold gate failed: score below threshold or an error-severity flag was found.')
  }

  return {
    passed,
    scoreValue: headSummary.score?.value ?? null,
    ...(badgeJson !== undefined ? { badgeJson } : {}),
  }
}
