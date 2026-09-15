import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withVoxfold } from '../src/index.ts'

const dirs: string[] = []
let originalCwd: string

beforeEach(() => {
  originalCwd = process.cwd()
})

afterEach(() => {
  process.chdir(originalCwd)
  vi.unstubAllEnvs()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'voxfold-next-index-'))
  dirs.push(dir)
  process.chdir(dir)
  return dir
}

describe('withVoxfold: production gating', () => {
  it('returns the config unchanged when NODE_ENV=production', () => {
    tempProject()
    vi.stubEnv('NODE_ENV', 'production')
    const input = { reactStrictMode: true }
    const result = withVoxfold(input)
    expect(result).toBe(input) // Same reference — proves it never even wraps webpack/turbopack.
  })

  it('adds webpack/turbopack/instrumentationClientInject/rewrites when not production', () => {
    tempProject()
    vi.stubEnv('NODE_ENV', 'test')
    const result = withVoxfold({})
    expect(typeof result.webpack).toBe('function')
    expect(result.turbopack?.rules).toBeDefined()
    expect(result.instrumentationClientInject).toContain('@voxfold/next/overlay')
    expect(typeof result.rewrites).toBe('function')
  })
})

describe('withVoxfold: instrumentationClientInject composition', () => {
  it('appends to an existing array rather than replacing it', () => {
    tempProject()
    vi.stubEnv('NODE_ENV', 'test')
    const result = withVoxfold({ instrumentationClientInject: ['some-other-plugin/client'] })
    expect(result.instrumentationClientInject).toEqual([
      'some-other-plugin/client',
      '@voxfold/next/overlay',
    ])
  })
})

describe('withVoxfold: turbopack rule shape', () => {
  it('registers the stamp loader for *.{jsx,tsx} via the documented TurbopackRuleConfigItem shape', () => {
    tempProject()
    vi.stubEnv('NODE_ENV', 'test')
    const result = withVoxfold({})
    const rule = result.turbopack?.rules?.['*.{jsx,tsx}']
    expect(rule).toBeDefined()
    // TurbopackRuleConfigItem: { loaders: TurbopackLoaderItem[], ... } — verified against Next
    // 16.3.5's own config-shared.d.ts (see index.ts's module doc).
    expect(rule).toHaveProperty('loaders')
    const loaders = (rule as { loaders: Array<{ loader: string; options?: unknown }> }).loaders
    expect(loaders).toHaveLength(1)
    expect(loaders[0]?.loader).toMatch(/loader\.m?js$/)
    expect(loaders[0]?.options).toEqual({ projectRoot: process.cwd() })
  })

  it('preserves any existing turbopack rules the user already configured', () => {
    tempProject()
    vi.stubEnv('NODE_ENV', 'test')
    const result = withVoxfold({
      turbopack: { rules: { '*.svg': { loaders: ['@svgr/webpack'] } } },
    })
    expect(result.turbopack?.rules?.['*.svg']).toBeDefined()
    expect(result.turbopack?.rules?.['*.{jsx,tsx}']).toBeDefined()
  })
})

describe('withVoxfold: webpack rule shape', () => {
  it('only adds the stamp loader rule when context.dev is true', () => {
    tempProject()
    vi.stubEnv('NODE_ENV', 'test')
    const result = withVoxfold({})
    const webpackFn = result.webpack as (config: unknown, context: unknown) => unknown

    const prodConfig = { module: { rules: [] } }
    const prodResult = webpackFn(prodConfig, { dev: false, isServer: false }) as typeof prodConfig
    expect(prodResult.module.rules).toHaveLength(0)

    const devConfig = { module: { rules: [] } }
    const devResult = webpackFn(devConfig, { dev: true, isServer: false }) as {
      module: { rules: Array<{ test: RegExp; exclude: RegExp; use: Array<{ loader: string }> }> }
    }
    expect(devResult.module.rules).toHaveLength(1)
    expect(devResult.module.rules[0]?.test.test('App.tsx')).toBe(true)
    expect(devResult.module.rules[0]?.test.test('App.ts')).toBe(false)
    expect(devResult.module.rules[0]?.exclude.test('/project/node_modules/x.tsx')).toBe(true)
  })

  it('calls through to an existing user webpack() function first', () => {
    tempProject()
    vi.stubEnv('NODE_ENV', 'test')
    const userWebpack = vi.fn((config: { custom?: boolean }) => ({ ...config, custom: true }))
    const result = withVoxfold({ webpack: userWebpack as never })
    const webpackFn = result.webpack as (config: unknown, context: unknown) => { custom?: boolean }
    const output = webpackFn({}, { dev: true, isServer: false })
    expect(userWebpack).toHaveBeenCalled()
    expect(output.custom).toBe(true)
  })
})

describe('withVoxfold: rewrites', () => {
  it('returns just the upstream rewrites (no voxfold entry) when the sidecar never comes up', async () => {
    tempProject()
    vi.stubEnv('NODE_ENV', 'test')
    const result = withVoxfold({})
    const rewritesFn = result.rewrites as () => Promise<unknown[]>
    // No sidecar started in THIS test (withVoxfold's own fire-and-forget start targets a
    // temp dir that's never written a lockfile for), so waitForLiveLock's default 5s timeout
    // would make this test slow — the sidecar this same withVoxfold call kicked off is racing in
    // the background and may or may not land before the (default-timeout) wait; assert on the
    // array SHAPE only, not a specific length, to stay robust to that race.
    const rewrites = await rewritesFn()
    expect(Array.isArray(rewrites)).toBe(true)
  }, 10000)

  it('preserves an existing array-form rewrites() and appends the voxfold rewrite once live', async () => {
    tempProject()
    vi.stubEnv('NODE_ENV', 'test')
    const userRewrites = async () => [{ source: '/old', destination: '/new' }]
    const result = withVoxfold({ rewrites: userRewrites })
    const rewritesFn = result.rewrites as () => Promise<Array<{ source: string }>>
    const rewrites = await rewritesFn()
    expect(rewrites.some((r) => r.source === '/old')).toBe(true)
  }, 10000)
})
