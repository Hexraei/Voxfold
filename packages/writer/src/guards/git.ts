/**
 * Step 2: the file must be tracked by git before we'll write to it (unless the caller opts out).
 *
 * A file git doesn't know about has no diff, no `git checkout` recovery path, and no history a
 * user would think to look at — writing to it silently is a much easier way to lose work than
 * writing to a tracked file, where every edit is one `git diff` away from being visible and one
 * `git checkout` away from being undone.
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { WriteError } from '../errors.ts'

export function assertGitTracked(file: string): void {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', file], {
      cwd: dirname(file),
      stdio: ['ignore', 'ignore', 'ignore'],
    })
  } catch {
    throw new WriteError(
      'UntrackedFile',
      `${file}: not tracked by git; pass allowUntracked to write anyway`,
    )
  }
}

/**
 * Add `.voxfold/` to this repo's local, unshared ignore list (`.git/info/exclude`) if it isn't
 * there already, so the undo history doesn't show up as an untracked file in every `git status`
 * a user runs after their first edit. `.git/info/exclude` rather than a committed `.gitignore`:
 * this directory is local tooling state, not something every contributor's ignore file should
 * carry, and writing to it requires no write access to tracked files at all.
 *
 * Best-effort: not inside a git repo, or the exclude file isn't writable, silently does nothing —
 * this is a convenience, not a step the write protocol's safety depends on.
 */
export function excludeVoxfoldDir(file: string): void {
  try {
    const fileDir = dirname(file)
    // `git rev-parse --git-dir` prints a path relative to the cwd it ran in (or absolute for a
    // repo using an external git-dir) — always resolve against `fileDir`, never the current
    // process's own cwd, which can be anywhere.
    const gitDirRaw = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: fileDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
    const gitDir = isAbsolute(gitDirRaw) ? gitDirRaw : join(fileDir, gitDirRaw)
    const excludePath = join(gitDir, 'info', 'exclude')
    const existing = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : ''
    if (/^\.voxfold\/?$/m.test(existing)) return
    const needsNewline = existing.length > 0 && !existing.endsWith('\n')
    appendFileSync(excludePath, `${needsNewline ? '\n' : ''}.voxfold/\n`)
  } catch {
    // Not a git repo, or the exclude file couldn't be written — not fatal.
  }
}
