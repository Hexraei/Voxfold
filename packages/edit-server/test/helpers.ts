import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A fresh git repo in a temp dir, with one file committed so the writer's git guard passes. */
export function makeTrackedRepo(fileName: string, content: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'vx-edit-server-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  const file = join(dir, fileName)
  writeFileSync(file, content, 'utf8')
  execFileSync('git', ['add', fileName], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir })
  return { dir, file }
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
