import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectFramework, runInit } from '../src/init'

describe('detectFramework', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voxfold-init-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns unknown with no package.json', async () => {
    expect(await detectFramework(dir)).toBe('unknown')
  })

  it('returns unknown for an unrelated project', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '^19' } }))
    expect(await detectFramework(dir)).toBe('unknown')
  })

  it('detects vite from dependencies', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { vite: '^7.0.0' } }))
    expect(await detectFramework(dir)).toBe('vite')
  })

  it('detects vite from devDependencies', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { vite: '^7.0.0' } }),
    )
    expect(await detectFramework(dir)).toBe('vite')
  })

  it('detects next', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '^16.0.0' } }))
    expect(await detectFramework(dir)).toBe('next')
  })

  it('detects astro', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { astro: '^6.0.0' } }))
    expect(await detectFramework(dir)).toBe('astro')
  })

  it('prefers next over vite when a project happens to declare both', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { next: '^16.0.0', vite: '^7.0.0' } }),
    )
    expect(await detectFramework(dir)).toBe('next')
  })

  it('returns unknown for malformed package.json rather than throwing', async () => {
    writeFileSync(join(dir, 'package.json'), '{ not valid json')
    expect(await detectFramework(dir)).toBe('unknown')
  })
})

describe('runInit', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voxfold-init-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes a starter config and reports the detected framework', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { vite: '^7.0.0' } }))
    const result = await runInit(dir)
    expect(result.framework).toBe('vite')
    expect(result.configWritten).toBe(true)
    expect(result.integrationPackage).toBe('@voxfold/vite')
    const written = readFileSync(join(dir, 'voxfold.config.ts'), 'utf8')
    expect(written).toContain('defineConfig')
  })

  it('does not overwrite an existing config', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({}))
    writeFileSync(join(dir, 'voxfold.config.ts'), '// custom content')
    const result = await runInit(dir)
    expect(result.configWritten).toBe(false)
    expect(readFileSync(join(dir, 'voxfold.config.ts'), 'utf8')).toBe('// custom content')
  })

  it('reports no integration package for an unknown framework', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({}))
    const result = await runInit(dir)
    expect(result.framework).toBe('unknown')
    expect(result.integrationPackage).toBeUndefined()
    expect(result.integrationSnippet).toBeUndefined()
  })
})
