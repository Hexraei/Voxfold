import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AstroIntegration } from 'astro'
import type { Plugin } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { voxfoldAstro } from '../src/index.ts'

/** Vite plugin hooks can be a function OR an object with a `.handler`; normalize, same helper as
 * `@voxfold/vite`'s own test suite. */
function callHook<T extends (...args: never[]) => unknown>(
  hook: T | { handler: T } | undefined,
  ...args: Parameters<T>
): ReturnType<T> {
  if (!hook) throw new Error('hook not defined')
  const fn = typeof hook === 'function' ? hook : hook.handler
  return fn.apply(undefined, args) as ReturnType<T>
}

function runConfigSetup(
  integration: AstroIntegration,
  command: 'dev' | 'build' | 'preview' | 'sync',
) {
  const updateConfig = vi.fn()
  const injectScript = vi.fn()
  const hook = integration.hooks['astro:config:setup']
  if (!hook) throw new Error('astro:config:setup hook not defined')
  hook({
    command,
    config: {} as never,
    isRestart: false,
    updateConfig,
    addRenderer: vi.fn(),
    addWatchFile: vi.fn(),
    injectScript,
    injectRoute: vi.fn(),
    addClientDirective: vi.fn(),
    addDevToolbarApp: vi.fn(),
    addMiddleware: vi.fn(),
    createCodegenDir: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
  } as never)
  return { updateConfig, injectScript }
}

describe('voxfoldAstro(): dev-only gating', () => {
  it('never calls updateConfig/injectScript for a production build', () => {
    const { updateConfig, injectScript } = runConfigSetup(voxfoldAstro(), 'build')
    expect(updateConfig).not.toHaveBeenCalled()
    expect(injectScript).not.toHaveBeenCalled()
  })

  it('never calls updateConfig/injectScript for preview', () => {
    const { updateConfig, injectScript } = runConfigSetup(voxfoldAstro(), 'preview')
    expect(updateConfig).not.toHaveBeenCalled()
    expect(injectScript).not.toHaveBeenCalled()
  })

  it('calls updateConfig and injectScript for dev', () => {
    const { updateConfig, injectScript } = runConfigSetup(voxfoldAstro(), 'dev')
    expect(updateConfig).toHaveBeenCalledTimes(1)
    expect(injectScript).toHaveBeenCalled()
  })
})

describe('voxfoldAstro(): vite config wiring', () => {
  it('registers an enforce: "pre" plugin that stamps .astro files', () => {
    const { updateConfig } = runConfigSetup(voxfoldAstro(), 'dev')
    const config = updateConfig.mock.calls[0]![0] as { vite: { plugins: Plugin[] } }
    const stampPlugin = config.vite.plugins.find((p) => p.name === 'voxfold:astro-stamp')
    expect(stampPlugin).toBeDefined()
    expect(stampPlugin!.enforce).toBe('pre')
  })

  it('registers markdown.rehypePlugins as a standard unified PluggableList entry', () => {
    const { updateConfig } = runConfigSetup(voxfoldAstro(), 'dev')
    const config = updateConfig.mock.calls[0]![0] as { markdown: { rehypePlugins: unknown[] } }
    expect(config.markdown.rehypePlugins).toHaveLength(1)
    expect(typeof config.markdown.rehypePlugins[0]).toBe('function')
  })

  it('injects the client bootstrap and config as page-stage scripts', () => {
    const { injectScript } = runConfigSetup(voxfoldAstro(), 'dev')
    const stages = injectScript.mock.calls.map((c) => c[0])
    const contents = injectScript.mock.calls.map((c) => c[1] as string)
    expect(stages).toEqual(['page', 'page'])
    expect(contents.some((c) => c.includes('window.__VOXFOLD__'))).toBe(true)
    expect(contents.some((c) => c.includes('virtual:voxfold/client.ts'))).toBe(true)
  })
})

describe('voxfoldAstro(): .astro stamp transform', () => {
  function getStampPlugin() {
    const { updateConfig } = runConfigSetup(voxfoldAstro(), 'dev')
    const config = updateConfig.mock.calls[0]![0] as { vite: { plugins: Plugin[] } }
    return config.vite.plugins.find((p) => p.name === 'voxfold:astro-stamp')!
  }

  it('never stamps while VITEST is set (guards this monorepo’s own test runs)', () => {
    expect(process.env.VITEST).toBeTruthy()
    const plugin = getStampPlugin()
    const code = '<p>We utilize a robust plan for everyone here.</p>'
    const result = callHook(plugin.transform, code, '/project/src/pages/index.astro', undefined)
    expect(result).toBeNull()
  })

  describe('with VITEST unset (simulating a real app dev server)', () => {
    let originalVitest: string | undefined
    beforeEach(() => {
      originalVitest = process.env.VITEST
      delete process.env.VITEST
    })
    afterEach(() => {
      if (originalVitest !== undefined) process.env.VITEST = originalVitest
    })

    it('stamps a .astro file with data-vf and returns a source map', () => {
      const plugin = getStampPlugin()
      const code = '<p>We utilize a robust plan for everyone here.</p>'
      const result = callHook(
        plugin.transform,
        code,
        '/project/src/pages/index.astro',
        undefined,
      ) as { code: string; map: unknown } | null
      expect(result).not.toBeNull()
      expect(result!.code).toContain('data-vf=')
      expect(result!.map).toBeDefined()
    })

    it('leaves non-.astro files untouched', () => {
      const plugin = getStampPlugin()
      const result = callHook(
        plugin.transform,
        'export const x = 1',
        '/project/src/util.ts',
        undefined,
      )
      expect(result).toBeNull()
    })

    it('skips node_modules even for .astro files', () => {
      const plugin = getStampPlugin()
      const code = '<p>Some vendor copy here that is long enough to matter.</p>'
      const result = callHook(
        plugin.transform,
        code,
        '/project/node_modules/some-lib/Widget.astro',
        undefined,
      )
      expect(result).toBeNull()
    })

    it('passes a file through unstamped rather than throwing on a syntax error', () => {
      const plugin = getStampPlugin()
      const brokenCode = '---\nconst x = {{{ broken\n---\n<p>text'
      expect(() =>
        callHook(plugin.transform, brokenCode, '/project/src/pages/Broken.astro', undefined),
      ).not.toThrow()
    })
  })
})

describe('voxfoldAstro(): client virtual module', () => {
  function getClientPlugin() {
    const { updateConfig } = runConfigSetup(voxfoldAstro(), 'dev')
    const config = updateConfig.mock.calls[0]![0] as { vite: { plugins: Plugin[] } }
    return config.vite.plugins.find((p) => p.name === 'voxfold:astro-client')!
  }

  it('resolves the virtual client id to a null-prefixed internal id', () => {
    const plugin = getClientPlugin()
    const resolved = callHook(plugin.resolveId, 'virtual:voxfold/client.ts', undefined, {
      isEntry: false,
    } as never)
    expect(resolved).toBe('\0virtual:voxfold/client.ts')
  })

  it("load() returns client.ts's source with bare package imports rewritten to absolute paths", () => {
    const plugin = getClientPlugin()
    const loaded = callHook(plugin.load, '\0virtual:voxfold/client.ts') as string
    const realSource = readFileSync(join(import.meta.dirname, '..', 'src', 'client.ts'), 'utf8')
    expect(loaded).not.toBe(realSource)
    expect(loaded).toMatch(/from '\//)
    expect(loaded).not.toContain("from '@voxfold/overlay'")
  })

  it('resolves preact to an absolute path for any importer', () => {
    const plugin = getClientPlugin()
    const resolved = callHook(plugin.resolveId, 'preact', undefined, { isEntry: false } as never)
    expect(resolved).toMatch(/^\/.*preact/)
  })
})

describe('voxfoldAstro(): edit-server middleware wiring', () => {
  it('mounts middleware on server.middlewares at astro:server:setup', () => {
    const integration = voxfoldAstro()
    runConfigSetup(integration, 'dev')

    const use = vi.fn()
    const hook = integration.hooks['astro:server:setup']
    if (!hook) throw new Error('astro:server:setup hook not defined')
    hook({
      server: {
        middlewares: { use },
        config: { root: '/project' },
      } as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      toolbar: {} as never,
    } as never)

    expect(use).toHaveBeenCalledTimes(1)
    expect(use.mock.calls[0]![0]).toBe('/__voxfold')
  })

  it('honors a custom basePath option', () => {
    const integration = voxfoldAstro({ basePath: '/__custom' })
    runConfigSetup(integration, 'dev')

    const use = vi.fn()
    const hook = integration.hooks['astro:server:setup']!
    hook({
      server: { middlewares: { use }, config: { root: '/project' } } as never,
      logger: {} as never,
      toolbar: {} as never,
    } as never)

    expect(use.mock.calls[0]![0]).toBe('/__custom')
  })
})
