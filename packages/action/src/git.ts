/**
 * Git plumbing via subprocess. Never checks out or mutates anything — only read commands
 * (`diff`, `show`, `merge-base`) against the already-checked-out working tree.
 */

import { exec } from '@actions/exec'

async function run(args: string[], cwd: string): Promise<string> {
  let stdout = ''
  await exec('git', args, {
    cwd,
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        stdout += data.toString()
      },
    },
    ignoreReturnCode: true,
  })
  return stdout
}

/** Common ancestor of base and head, so the diff matches what GitHub shows on the PR. */
export async function mergeBase(cwd: string, base: string, head: string): Promise<string> {
  const out = await run(['merge-base', base, head], cwd)
  const sha = out.trim()
  return sha || base
}

/** Files changed between two refs, respecting rename detection (old path is dropped). */
export async function changedFiles(cwd: string, base: string, head: string): Promise<string[]> {
  const out = await run(['diff', '--name-only', `${base}...${head}`], cwd)
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Content of a file at a given ref, or undefined if it did not exist there. */
export async function showFile(
  cwd: string,
  ref: string,
  path: string,
): Promise<string | undefined> {
  let stdout = ''
  const code = await exec('git', ['show', `${ref}:${path}`], {
    cwd,
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        stdout += data.toString()
      },
    },
    ignoreReturnCode: true,
  })
  if (code !== 0) return undefined
  return stdout
}

/** One `@@ -a,b +c,d @@` hunk's new-side line range, half-open [start, end). */
export interface DiffHunk {
  newStart: number
  newEnd: number
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

/** Per-file map of new-side line numbers touched by the diff (added or context inside a hunk). */
export async function diffHunks(
  cwd: string,
  base: string,
  head: string,
  paths: readonly string[],
): Promise<Map<string, DiffHunk[]>> {
  const result = new Map<string, DiffHunk[]>()
  if (paths.length === 0) return result

  const out = await run(['diff', '--unified=0', `${base}...${head}`, '--', ...paths], cwd)
  let currentFile: string | undefined
  for (const line of out.split('\n')) {
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).trim()
      currentFile = path === '/dev/null' ? undefined : path.replace(/^b\//, '')
      continue
    }
    const match = HUNK_HEADER.exec(line)
    if (match && currentFile) {
      const start = Number(match[1])
      const count = match[2] === undefined ? 1 : Number(match[2])
      if (count === 0) continue // pure deletion, nothing on the new side to annotate
      const list = result.get(currentFile) ?? []
      list.push({ newStart: start, newEnd: start + count })
      result.set(currentFile, list)
    }
  }
  return result
}

export function lineInHunks(hunks: readonly DiffHunk[] | undefined, line: number): boolean {
  if (!hunks) return false
  return hunks.some((h) => line >= h.newStart && line < h.newEnd)
}
