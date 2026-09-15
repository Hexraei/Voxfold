/**
 * `.voxfold/server.json` lockfile: prevents `withVoxfold` from starting a duplicate sidecar across
 * Next's own repeated config evaluation.
 *
 * `next.config.js` (and the `withVoxfold(...)` call inside it) is evaluated MULTIPLE times per
 * `next dev` invocation — at minimum once for the main process and again inside each Turbopack/
 * webpack worker that needs the resolved config, and Next's own docs and issue tracker document
 * config re-evaluation happening across HMR-triggered restarts too. Starting a fresh `node:http`
 * server on every evaluation would leak listening sockets and hand out a different port each time,
 * breaking the overlay's `env`-baked sidecar URL (see `index.ts`'s module doc) the moment a second
 * evaluation ran after the client bundle had already captured the first port.
 *
 * The lockfile is trusted only after checking the recorded PID is BOTH alive (`process.kill(pid,
 * 0)`, the standard no-signal liveness probe) AND actually still listening on the recorded port
 * (a real TCP connect attempt) — a stale lockfile from a previous `next dev` that crashed without
 * cleanup, or a PID reused by an unrelated process since, must never be trusted on the strength of
 * the file's mere existence.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'

export interface LockfileData {
  port: number
  pid: number
  token: string
}

function lockfilePath(projectRoot: string): string {
  return join(projectRoot, '.voxfold', 'server.json')
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 sends nothing; it only checks permission/existence. Throws ESRCH if the process
    // is gone, EPERM if it exists but is owned by someone else (still "alive" for our purposes).
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function isPortListening(port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ host: '127.0.0.1', port, timeout: timeoutMs })
    const finish = (result: boolean) => {
      socket.destroy()
      resolvePromise(result)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}

/** Reads the lockfile and returns it only if it names a process that is genuinely still serving. */
export async function readLiveLock(projectRoot: string): Promise<LockfileData | undefined> {
  const path = lockfilePath(projectRoot)
  if (!existsSync(path)) return undefined

  let data: LockfileData
  try {
    data = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined // Corrupt lockfile — treat as absent, a fresh sidecar will overwrite it.
  }

  if (!data || typeof data.pid !== 'number' || typeof data.port !== 'number') return undefined
  if (!isProcessAlive(data.pid)) return undefined
  if (!(await isPortListening(data.port))) return undefined
  return data
}

/**
 * Polls for a live lockfile up to `timeoutMs`, for `rewrites()` (see `index.ts`) to await the
 * sidecar's own async startup before Next finalizes its dev-server routing table. Short interval,
 * short timeout: `startSidecar` is a single `http.Server.listen(0, ...)` call with no I/O of its
 * own before that, so it resolves in low single-digit milliseconds in practice — this loop is a
 * safety margin for a slow CI sandbox or a heavily loaded dev machine, not the expected path.
 */
export async function waitForLiveLock(
  projectRoot: string,
  timeoutMs = 5000,
): Promise<LockfileData | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const lock = await readLiveLock(projectRoot)
    if (lock) return lock
    if (Date.now() >= deadline) return undefined
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

export function writeLock(projectRoot: string, data: LockfileData): void {
  const path = lockfilePath(projectRoot)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2))
}

export function newToken(): string {
  return randomBytes(16).toString('hex')
}
