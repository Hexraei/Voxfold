import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverFiles, findGitRoot, formatForPath } from '../src/discover'

describe('formatForPath', () => {
  it('maps extensions to formats', () => {
    expect(formatForPath('a.md')).toBe('markdown')
    expect(formatForPath('a.MDX')).toBe('mdx')
    expect(formatForPath('a.html')).toBe('html')
    expect(formatForPath('a.htm')).toBe('html')
    expect(formatForPath('a.txt')).toBeUndefined()
    expect(formatForPath('noextension')).toBeUndefined()
  })
})

describe('discoverFiles', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voxfold-discover-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('finds lintable files in a directory, ignoring unsupported extensions', async () => {
    writeFileSync(join(dir, 'a.md'), '# a')
    writeFileSync(join(dir, 'b.html'), '<p>b</p>')
    writeFileSync(join(dir, 'c.txt'), 'c')
    const files = await discoverFiles({ cwd: dir, patterns: [], useGitignore: false })
    expect(files.map((f) => f.split('/').pop())).toEqual(['a.md', 'b.html'])
  })

  it('treats a bare file argument literally, not as a glob', async () => {
    writeFileSync(join(dir, 'README.md'), '# hi')
    const files = await discoverFiles({ cwd: dir, patterns: ['README.md'], useGitignore: false })
    expect(files).toHaveLength(1)
    expect(files[0]!.endsWith('README.md')).toBe(true)
  })

  it('respects .gitignore by default', async () => {
    writeFileSync(join(dir, '.gitignore'), 'ignored.md\n')
    writeFileSync(join(dir, 'ignored.md'), '# ignored')
    writeFileSync(join(dir, 'kept.md'), '# kept')
    const files = await discoverFiles({ cwd: dir, patterns: [], useGitignore: true })
    expect(files.map((f) => f.split('/').pop())).toEqual(['kept.md'])
  })

  it('--no-gitignore includes files a .gitignore would otherwise hide', async () => {
    writeFileSync(join(dir, '.gitignore'), 'ignored.md\n')
    writeFileSync(join(dir, 'ignored.md'), '# ignored')
    const files = await discoverFiles({ cwd: dir, patterns: [], useGitignore: false })
    expect(files.map((f) => f.split('/').pop())).toEqual(['ignored.md'])
  })

  it('always skips node_modules regardless of .gitignore', async () => {
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'vendored.md'), '# nope')
    writeFileSync(join(dir, 'real.md'), '# real')
    const files = await discoverFiles({ cwd: dir, patterns: [], useGitignore: false })
    expect(files.map((f) => f.split('/').pop())).toEqual(['real.md'])
  })

  it('never throws on a path outside cwd (regression: ignore package path escape)', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'voxfold-outside-'))
    try {
      writeFileSync(join(outside, 'x.md'), '# x')
      const files = await discoverFiles({
        cwd: dir,
        patterns: [join(outside, 'x.md')],
        useGitignore: true,
      })
      expect(files).toHaveLength(1)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('applies extra ignore patterns from --ignore-pattern', async () => {
    writeFileSync(join(dir, 'skip.md'), '# skip')
    writeFileSync(join(dir, 'keep.md'), '# keep')
    const files = await discoverFiles({
      cwd: dir,
      patterns: [],
      useGitignore: false,
      extraIgnores: ['skip.md'],
    })
    expect(files.map((f) => f.split('/').pop())).toEqual(['keep.md'])
  })
})

describe('findGitRoot', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voxfold-gitroot-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('finds the directory containing .git', () => {
    mkdirSync(join(dir, '.git'))
    mkdirSync(join(dir, 'sub', 'deeper'), { recursive: true })
    expect(findGitRoot(join(dir, 'sub', 'deeper'))).toBe(dir)
  })

  it('falls back to cwd when no .git is found', () => {
    expect(findGitRoot(dir)).toBe(dir)
  })
})
