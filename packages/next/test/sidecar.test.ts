import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { newToken } from '../src/lockfile.ts'
import { type Sidecar, startSidecar } from '../src/sidecar.ts'

const dirs: string[] = []
const sidecars: Sidecar[] = []
afterEach(async () => {
  for (const sidecar of sidecars.splice(0)) await sidecar.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'voxfold-next-sidecar-'))
  dirs.push(dir)
  return dir
}

async function boot(projectRoot: string, token = newToken()) {
  const sidecar = await startSidecar({ projectRoot, token })
  sidecars.push(sidecar)
  return sidecar
}

describe('startSidecar', () => {
  it('listens on 127.0.0.1 with a real ephemeral port', async () => {
    const sidecar = await boot(tempProject())
    expect(sidecar.port).toBeGreaterThan(0)
  })

  it('GET /token returns the session token as plain text, no auth required', async () => {
    const sidecar = await boot(tempProject())
    const response = await fetch(`http://127.0.0.1:${sidecar.port}/token`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(sidecar.token)
  })

  it('GET /style.css returns non-empty CSS text', async () => {
    const sidecar = await boot(tempProject())
    const response = await fetch(`http://127.0.0.1:${sidecar.port}/style.css`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/css')
    const text = await response.text()
    expect(text.length).toBeGreaterThan(0)
  })

  it('rejects a POST route without the session token', async () => {
    const sidecar = await boot(tempProject())
    const response = await fetch(`http://127.0.0.1:${sidecar.port}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stampId: 'x' }),
    })
    expect(response.status).toBe(403)
    const body = (await response.json()) as { code: string }
    expect(body.code).toBe('InvalidToken')
  })

  it('POST /register accepts stamp entries without a token (loader-only route)', async () => {
    const projectRoot = tempProject()
    writeFileSync(join(projectRoot, 'Hero.tsx'), 'export const x = 1')
    const sidecar = await boot(projectRoot)

    const response = await fetch(`http://127.0.0.1:${sidecar.port}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        relativePath: 'Hero.tsx',
        format: 'jsx',
        fileHash: 'deadbeef',
        entries: [],
      }),
    })
    expect(response.status).toBe(200)
  })

  it('an unknown stamp id 404s from /resolve, once registered a valid one resolves', async () => {
    const projectRoot = tempProject()
    writeFileSync(join(projectRoot, 'Hero.tsx'), 'export const x = 1')
    const sidecar = await boot(projectRoot)

    const unknown = await fetch(`http://127.0.0.1:${sidecar.port}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-voxfold-token': sidecar.token },
      body: JSON.stringify({ stampId: 'nope' }),
    })
    expect(unknown.status).toBe(404)

    await fetch(`http://127.0.0.1:${sidecar.port}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        relativePath: 'Hero.tsx',
        format: 'jsx',
        fileHash: 'deadbeef',
        entries: [
          { id: 'abc123', relativePath: 'Hero.tsx', format: 'jsx', nodePath: '0', refs: [] },
        ],
      }),
    })

    const resolved = await fetch(`http://127.0.0.1:${sidecar.port}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-voxfold-token': sidecar.token },
      body: JSON.stringify({ stampId: 'abc123' }),
    })
    expect(resolved.status).toBe(200)
    const body = (await resolved.json()) as { relativePath: string }
    expect(body.relativePath).toBe('Hero.tsx')
  })
})
