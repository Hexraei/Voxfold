import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { changedFiles, diffHunks, lineInHunks, mergeBase, showFile } from '../src/git.ts'

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

describe('git plumbing', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voxfold-action-git-'))
    git(dir, ['init', '-q', '-b', 'main'])
    git(dir, ['config', 'user.email', 'test@example.com'])
    git(dir, ['config', 'user.name', 'Test'])
    writeFileSync(join(dir, 'a.md'), 'line one\nline two\nline three\n')
    git(dir, ['add', '.'])
    git(dir, ['commit', '-q', '-m', 'base'])
    git(dir, ['checkout', '-q', '-b', 'feature'])
    writeFileSync(join(dir, 'a.md'), 'line one\nCHANGED line two\nline three\nline four\n')
    git(dir, ['add', '.'])
    git(dir, ['commit', '-q', '-m', 'head'])
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('finds the merge base between two branches', async () => {
    const base = await mergeBase(dir, 'main', 'feature')
    expect(base).toMatch(/^[0-9a-f]{40}$/)
  })

  it('lists changed files between refs', async () => {
    const files = await changedFiles(dir, 'main', 'feature')
    expect(files).toEqual(['a.md'])
  })

  it('reads a file at an old ref without checking it out', async () => {
    const content = await showFile(dir, 'main', 'a.md')
    expect(content).toBe('line one\nline two\nline three\n')
  })

  it('returns undefined for a file that did not exist at that ref', async () => {
    const content = await showFile(dir, 'main', 'does-not-exist.md')
    expect(content).toBeUndefined()
  })

  it('parses hunks to the new-side line ranges actually touched by the diff', async () => {
    const hunks = await diffHunks(dir, 'main', 'feature', ['a.md'])
    const fileHunks = hunks.get('a.md')
    expect(fileHunks).toBeDefined()
    // line 2 changed, line 4 added -> new-side ranges should cover both, not line 1 or 3
    expect(lineInHunks(fileHunks, 1)).toBe(false)
    expect(lineInHunks(fileHunks, 2)).toBe(true)
    expect(lineInHunks(fileHunks, 3)).toBe(false)
    expect(lineInHunks(fileHunks, 4)).toBe(true)
  })
})
