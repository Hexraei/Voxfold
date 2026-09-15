import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { newToken, readLiveLock, waitForLiveLock, writeLock } from '../src/lockfile.ts'
import { startSidecar } from '../src/sidecar.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'voxfold-next-lockfile-'))
  dirs.push(dir)
  return dir
}

describe('readLiveLock', () => {
  it('returns undefined when no lockfile exists', async () => {
    const dir = tempProject()
    expect(await readLiveLock(dir)).toBeUndefined()
  })

  it('returns undefined for a corrupt lockfile', async () => {
    const dir = tempProject()
    writeLock(dir, { port: 1, pid: process.pid, token: 'x' })
    // Corrupt it.
    const path = join(dir, '.voxfold', 'server.json')
    const fs = await import('node:fs')
    fs.writeFileSync(path, '{not json')
    expect(await readLiveLock(dir)).toBeUndefined()
  })

  it('returns undefined when the recorded PID is not alive', async () => {
    const dir = tempProject()
    // A PID astronomically unlikely to be alive/reused during this test run.
    writeLock(dir, { port: 65000, pid: 999999, token: 'x' })
    expect(await readLiveLock(dir)).toBeUndefined()
  })

  it('returns undefined when the PID is alive but nothing listens on the recorded port', async () => {
    const dir = tempProject()
    // This test process itself is alive, but almost certainly nothing listens on this port.
    writeLock(dir, { port: 1, pid: process.pid, token: 'x' })
    expect(await readLiveLock(dir)).toBeUndefined()
  })

  it('returns the lock data when the process is alive and the port is genuinely listening', async () => {
    const dir = tempProject()
    const sidecar = await startSidecar({ projectRoot: dir, token: newToken() })
    try {
      writeLock(dir, { port: sidecar.port, pid: process.pid, token: sidecar.token })
      const lock = await readLiveLock(dir)
      expect(lock).toEqual({ port: sidecar.port, pid: process.pid, token: sidecar.token })
    } finally {
      await sidecar.close()
    }
  })
})

describe('writeLock', () => {
  it('creates the .voxfold directory and writes JSON', () => {
    const dir = tempProject()
    writeLock(dir, { port: 4242, pid: 1, token: 'abc' })
    const raw = readFileSync(join(dir, '.voxfold', 'server.json'), 'utf8')
    expect(JSON.parse(raw)).toEqual({ port: 4242, pid: 1, token: 'abc' })
  })
})

describe('waitForLiveLock', () => {
  it('resolves immediately when the lock is already live', async () => {
    const dir = tempProject()
    const sidecar = await startSidecar({ projectRoot: dir, token: newToken() })
    try {
      writeLock(dir, { port: sidecar.port, pid: process.pid, token: sidecar.token })
      const lock = await waitForLiveLock(dir, 1000)
      expect(lock?.port).toBe(sidecar.port)
    } finally {
      await sidecar.close()
    }
  })

  it('times out and returns undefined when no lock ever appears', async () => {
    const dir = tempProject()
    const lock = await waitForLiveLock(dir, 100)
    expect(lock).toBeUndefined()
  })
})

describe('newToken', () => {
  it('produces a 32-char hex string, different each call', () => {
    const a = newToken()
    const b = newToken()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })
})
