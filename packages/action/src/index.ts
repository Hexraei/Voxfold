/** GitHub Action entrypoint: reads INPUT_ and GITHUB_ env vars, drives runAction, reports via core. */

import * as core from '@actions/core'
import * as github from '@actions/github'
import { runAction } from './run.ts'

function boolInput(name: string, fallback: boolean): boolean {
  const raw = core.getInput(name)
  if (raw === '') return fallback
  return raw.toLowerCase() === 'true'
}

function numberInput(name: string): number | undefined {
  const raw = core.getInput(name)
  if (raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

async function main(): Promise<void> {
  const cwd = process.cwd()
  const pathsInput = core.getInput('paths')
  const paths =
    pathsInput === ''
      ? ['.']
      : pathsInput
          .split(/\r?\n|,/)
          .map((s) => s.trim())
          .filter(Boolean)

  const token = core.getInput('github-token')
  const context = github.context
  const isPullRequest =
    context.eventName === 'pull_request' || context.eventName === 'pull_request_target'
  const isDefaultBranchPush =
    context.eventName === 'push' &&
    context.ref === `refs/heads/${context.payload.repository?.default_branch}`

  const pr = context.payload.pull_request as
    | { base?: { sha?: string }; head?: { sha?: string }; number?: number }
    | undefined

  const octokit = token && isPullRequest ? github.getOctokit(token) : undefined

  const minScore = numberInput('min-score')
  const minFileScore = numberInput('min-file-score')
  const baseRef = pr?.base?.sha
  const headRef = pr?.head?.sha
  const issueNumber = pr?.number

  const result = await runAction(
    {
      cwd,
      paths,
      ...(minScore !== undefined ? { minScore } : {}),
      ...(minFileScore !== undefined ? { minFileScore } : {}),
      comment: boolInput('comment', true),
      annotations: boolInput('annotations', true),
      badge: boolInput('badge', false),
      ...(baseRef !== undefined ? { baseRef } : {}),
      ...(headRef !== undefined ? { headRef } : {}),
      isPullRequest,
      isDefaultBranchPush,
      repo: context.repo,
      ...(issueNumber !== undefined ? { issueNumber } : {}),
    },
    octokit,
    {
      warning: core.warning,
      notice: core.notice,
      setOutput: core.setOutput,
      setFailed: core.setFailed,
    },
  )

  if (!result.passed) process.exitCode = 1
}

main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
