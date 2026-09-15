import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import voxfoldStampLoader from '../src/loader.ts'
import { newToken, writeLock } from '../src/lockfile.ts'
import { type Sidecar, startSidecar } from '../src/sidecar.ts'

const dirs: string[] = []
const sidecars: Sidecar[] = []
afterEach(async () => {
  for (const sidecar of sidecars.splice(0)) await sidecar.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'voxfold-next-loader-'))
  dirs.push(dir)
  return dir
}

function fakeLoaderContext(resourcePath: string, options: unknown) {
  return { getOptions: () => options, resourcePath }
}

describe('voxfoldStampLoader', () => {
  it('passes source through unchanged when misconfigured (no projectRoot)', () => {
    const source = 'export default function App() { return <p>Hi there friends</p> }'
    const result = voxfoldStampLoader.call(fakeLoaderContext('/project/App.tsx', {}), source)
    expect(result).toBe(source)
  })

  it('passes node_modules files through unstamped', () => {
    const source = 'export default function App() { return <p>Hi there friends</p> }'
    const context = fakeLoaderContext('/project/node_modules/pkg/App.tsx', {
      projectRoot: '/project',
    })
    const result = voxfoldStampLoader.call(context, source)
    expect(result).toBe(source)
  })

  it('stamps a JSX file with data-vf and returns the transformed code', () => {
    const projectRoot = tempProject()
    const source = 'export default function App() { return <p>We utilize a robust plan here.</p> }'
    const context = fakeLoaderContext(join(projectRoot, 'App.tsx'), { projectRoot })
    const result = voxfoldStampLoader.call(context, source)
    expect(result).toContain('data-vf=')
    expect(result).not.toBe(source)
  })

  it('passes a file that fails to parse through unstamped rather than throwing', () => {
    const projectRoot = tempProject()
    const source = 'this is not valid <<< jsx {{{'
    const context = fakeLoaderContext(join(projectRoot, 'Broken.tsx'), { projectRoot })
    expect(() => voxfoldStampLoader.call(context, source)).not.toThrow()
    expect(voxfoldStampLoader.call(context, source)).toBe(source)
  })

  it('registers stamp entries with a live sidecar via POST /register', async () => {
    const projectRoot = tempProject()
    const token = newToken()
    const sidecar = await startSidecar({ projectRoot, token })
    sidecars.push(sidecar)
    writeLock(projectRoot, { port: sidecar.port, pid: process.pid, token: sidecar.token })

    const source = 'export default function App() { return <p>We utilize a robust plan here.</p> }'
    const context = fakeLoaderContext(join(projectRoot, 'App.tsx'), { projectRoot })
    voxfoldStampLoader.call(context, source)

    // The registration fetch is fire-and-forget from the loader's own return value — give it a
    // tick to land before asserting against the sidecar's registry via /resolve.
    await new Promise((r) => setTimeout(r, 50))

    // Pull the stamp id back out of the transformed code to confirm it's now resolvable.
    const stamped = voxfoldStampLoader.call(context, source) as string
    const match = stamped.match(/data-vf="([a-f0-9]+)"/)
    expect(match).not.toBeNull()

    await new Promise((r) => setTimeout(r, 50))

    const response = await fetch(`http://127.0.0.1:${sidecar.port}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-voxfold-token': sidecar.token },
      body: JSON.stringify({ stampId: match?.[1] }),
    })
    expect(response.status).toBe(200)
  })
})
