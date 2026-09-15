import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger, RunInputs } from '../src/run.ts'
import { runAction } from '../src/run.ts'
import type { OctokitLike } from '../src/sticky-comment.ts'

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

const CLEAN_PARAGRAPH =
  'This document explains the feature in plain language. It covers setup, configuration, and common questions people ask. Each section builds on the last so a new reader can follow along without prior context. The examples use realistic values so they can be copied directly into a project. '

const AI_TELL_PARAGRAPH =
  "This document isn't just a guide — it's a comprehensive resource that seamlessly empowers every reader. We utilize a robust, cutting-edge approach that truly transforms the experience for everyone involved in the process today. "

function makeLogger(): Logger & { outputs: Record<string, string>; failedMessages: string[] } {
  const outputs: Record<string, string> = {}
  const failedMessages: string[] = []
  return {
    warning: () => {},
    notice: () => {},
    setOutput: (name, value) => {
      outputs[name] = value
    },
    setFailed: (msg) => {
      failedMessages.push(msg)
    },
    outputs,
    failedMessages,
  }
}

function fakeOctokit(): { octokit: OctokitLike; created: string[]; updated: string[] } {
  const created: string[] = []
  const updated: string[] = []
  const octokit: OctokitLike = {
    rest: {
      issues: {
        listComments: vi.fn().mockResolvedValue({ data: [] }),
        createComment: vi.fn().mockImplementation(({ body }) => {
          created.push(body)
          return Promise.resolve({})
        }),
        updateComment: vi.fn().mockImplementation(({ body }) => {
          updated.push(body)
          return Promise.resolve({})
        }),
      },
    },
  }
  return { octokit, created, updated }
}

describe('runAction end-to-end', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voxfold-action-run-'))
    git(dir, ['init', '-q', '-b', 'main'])
    git(dir, ['config', 'user.email', 'test@example.com'])
    git(dir, ['config', 'user.name', 'Test'])
    // Base: clean doc, plus a second file untouched by the PR.
    writeFileSync(join(dir, 'guide.md'), CLEAN_PARAGRAPH.repeat(3))
    writeFileSync(join(dir, 'untouched.md'), AI_TELL_PARAGRAPH.repeat(3))
    git(dir, ['add', '.'])
    git(dir, ['commit', '-q', '-m', 'base'])
    git(dir, ['checkout', '-q', '-b', 'feature'])
    // Head: guide.md gains AI-tell prose (new flags); untouched.md is left alone so its
    // pre-existing flags must NOT be annotated.
    writeFileSync(
      join(dir, 'guide.md'),
      `${CLEAN_PARAGRAPH.repeat(3)}\n\n${AI_TELL_PARAGRAPH.repeat(3)}`,
    )
    git(dir, ['add', '.'])
    git(dir, ['commit', '-q', '-m', 'head'])
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lints head, diffs against base, upserts a sticky comment, and reports outputs', async () => {
    const { octokit, created } = fakeOctokit()
    const log = makeLogger()

    const inputs: RunInputs = {
      cwd: dir,
      paths: ['.'],
      comment: true,
      annotations: true,
      badge: false,
      baseRef: 'main',
      headRef: 'feature',
      isPullRequest: true,
      isDefaultBranchPush: false,
      repo: { owner: 'acme', repo: 'widgets' },
      issueNumber: 1,
    }

    const result = await runAction(inputs, octokit, log)

    // guide.md picked up new AI-tell flags on head; the comment should reflect that.
    expect(created).toHaveLength(1)
    expect(created[0]).toContain('voxfold:sticky')
    expect(created[0]).toContain('New flags:')

    expect(Number(log.outputs['new-flags'])).toBeGreaterThan(0)
    expect(log.outputs.score).not.toBe('')
    expect(result.scoreValue).not.toBeNull()
  })

  it('only annotates flags inside the PR diff, never pre-existing flags in untouched files', async () => {
    const { octokit } = fakeOctokit()
    const log = makeLogger()
    const writes: string[] = []
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk))
      return true
    })

    try {
      await runAction(
        {
          cwd: dir,
          paths: ['.'],
          comment: false,
          annotations: true,
          badge: false,
          baseRef: 'main',
          headRef: 'feature',
          isPullRequest: true,
          isDefaultBranchPush: false,
          repo: { owner: 'acme', repo: 'widgets' },
          issueNumber: 1,
        },
        octokit,
        log,
      )
    } finally {
      stdoutSpy.mockRestore()
    }

    const annotationLines = writes.filter(
      (w) => w.startsWith('::warning') || w.startsWith('::error'),
    )
    expect(annotationLines.some((l) => l.includes('file=guide.md'))).toBe(true)
    expect(annotationLines.some((l) => l.includes('file=untouched.md'))).toBe(false)
  })

  it('fails the gate when min-score is not met', async () => {
    const { octokit } = fakeOctokit()
    const log = makeLogger()

    const result = await runAction(
      {
        cwd: dir,
        paths: ['.'],
        minScore: 99,
        comment: false,
        annotations: false,
        badge: false,
        baseRef: 'main',
        headRef: 'feature',
        isPullRequest: true,
        isDefaultBranchPush: false,
        repo: { owner: 'acme', repo: 'widgets' },
        issueNumber: 1,
      },
      octokit,
      log,
    )

    expect(result.passed).toBe(false)
    expect(log.failedMessages).toHaveLength(1)
    expect(log.outputs.passed).toBe('false')
  })

  it('passes the gate with a lenient threshold', async () => {
    const { octokit } = fakeOctokit()
    const log = makeLogger()

    const result = await runAction(
      {
        cwd: dir,
        paths: ['.'],
        minScore: 0,
        comment: false,
        annotations: false,
        badge: false,
        baseRef: 'main',
        headRef: 'feature',
        isPullRequest: true,
        isDefaultBranchPush: false,
        repo: { owner: 'acme', repo: 'widgets' },
        issueNumber: 1,
      },
      octokit,
      log,
    )

    expect(result.passed).toBe(true)
    expect(log.failedMessages).toHaveLength(0)
  })

  it('computes badge JSON only on a default-branch push, not on a PR', async () => {
    const { octokit } = fakeOctokit()
    const log = makeLogger()

    const prResult = await runAction(
      {
        cwd: dir,
        paths: ['.'],
        comment: false,
        annotations: false,
        badge: true,
        baseRef: 'main',
        headRef: 'feature',
        isPullRequest: true,
        isDefaultBranchPush: false,
        repo: { owner: 'acme', repo: 'widgets' },
        issueNumber: 1,
      },
      octokit,
      log,
    )
    expect(prResult.badgeJson).toBeUndefined()

    const pushLog = makeLogger()
    const pushResult = await runAction(
      {
        cwd: dir,
        paths: ['.'],
        comment: false,
        annotations: false,
        badge: true,
        isPullRequest: false,
        isDefaultBranchPush: true,
        repo: { owner: 'acme', repo: 'widgets' },
      },
      undefined,
      pushLog,
    )
    expect(pushResult.badgeJson).toBeDefined()
    const parsed = JSON.parse(pushResult.badgeJson!)
    expect(parsed.schemaVersion).toBe(1)
    expect(pushLog.outputs['badge-json']).toBe(pushResult.badgeJson)
  })
})
