import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { voxfold } from '../src/index.ts'

/** Vite plugin hooks can be a function OR an object with a `.handler`; normalize for testing. */
function callHook<T extends (...args: never[]) => unknown>(
  hook: T | { handler: T } | undefined,
  ...args: Parameters<T>
): ReturnType<T> {
  if (!hook) throw new Error('hook not defined')
  const fn = typeof hook === 'function' ? hook : hook.handler
  return fn.apply(undefined, args) as ReturnType<T>
}

describe('voxfold() plugin shape', () => {
  it('is a dev-only plugin (apply: "serve")', () => {
    const plugin = voxfold()
    expect(plugin.apply).toBe('serve')
    expect(plugin.name).toBe('voxfold')
  })
})

describe('virtual client module', () => {
  it('resolves the virtual client id to a null-prefixed internal id', () => {
    const plugin = voxfold()
    const resolved = callHook(plugin.resolveId, 'virtual:voxfold/client.ts', undefined, {
      isEntry: false,
    } as never)
    expect(resolved).toBe('\0virtual:voxfold/client.ts')
  })

  it('does not resolve unrelated ids', () => {
    const plugin = voxfold()
    const resolved = callHook(plugin.resolveId, './some/other/module.ts', undefined, {
      isEntry: false,
    } as never)
    expect(resolved).toBeNull()
  })

  it('resolves preact and its subpaths to the same instance for any importer', () => {
    const plugin = voxfold()
    for (const specifier of ['preact', 'preact/hooks', 'preact/jsx-runtime']) {
      const resolved = callHook(plugin.resolveId, specifier, undefined, {
        isEntry: false,
      } as never)
      expect(resolved).toMatch(/^(?:\/|[A-Za-z]:\/).*preact/)
      expect(resolved).not.toMatch(/^file:\/\//)
    }
  })

  it("load() returns client.ts's source with its bare package imports rewritten to absolute paths", () => {
    const plugin = voxfold()
    const loaded = callHook(plugin.load, '\0virtual:voxfold/client.ts') as string
    const realSource = readFileSync(join(import.meta.dirname, '..', 'src', 'client.ts'), 'utf8')

    // Same file, modulo the bare specifiers this module doc says get rewritten.
    expect(loaded).not.toBe(realSource)
    expect(loaded).toMatch(/from '(?:\/|[A-Za-z]:\/)/)
    expect(loaded).not.toContain("from 'file://")
    expect(loaded).not.toContain("from '@voxfold/overlay'")
    expect(loaded).not.toMatch(/from '[^']*\\/)
  })

  it('load() returns null for anything else', () => {
    const plugin = voxfold()
    expect(callHook(plugin.load, '/some/app/file.ts')).toBeNull()
  })
})

describe('JSX stamp transform', () => {
  it('never stamps while VITEST is set (guards a consuming app’s own Vitest runs)', () => {
    // Documents and proves the guard itself, using the ambient VITEST=true this suite already
    // runs under, before the other tests below deliberately unset it to exercise stamping.
    expect(process.env.VITEST).toBeTruthy()
    const plugin = voxfold()
    const code = `function App() { return <p>We utilize a robust plan for everyone here.</p> }`
    const result = callHook(plugin.transform, code, '/project/src/App.tsx', undefined)
    expect(result).toBeNull()
  })

  describe('with VITEST unset (simulating a real app dev server, not this test run)', () => {
    let originalVitest: string | undefined

    beforeEach(() => {
      originalVitest = process.env.VITEST
      delete process.env.VITEST
    })
    afterEach(() => {
      if (originalVitest !== undefined) process.env.VITEST = originalVitest
    })

    it('stamps a .tsx file with data-vf and returns a source map', () => {
      const plugin = voxfold()
      const code = `function App() { return <p>We utilize a robust plan for everyone here.</p> }`
      const result = callHook(plugin.transform, code, '/project/src/App.tsx', undefined) as {
        code: string
        map: unknown
      } | null

      expect(result).not.toBeNull()
      expect(result!.code).toContain('data-vf=')
      expect(result!.map).toBeDefined()
    })

    it('leaves non-JSX files untouched', () => {
      const plugin = voxfold()
      const result = callHook(
        plugin.transform,
        'export const x = 1',
        '/project/src/util.ts',
        undefined,
      )
      expect(result).toBeNull()
    })

    it('skips node_modules even for .tsx files', () => {
      const plugin = voxfold()
      const code = `function Vendor() { return <p>Some vendor copy here that is long enough.</p> }`
      const result = callHook(
        plugin.transform,
        code,
        '/project/node_modules/some-lib/Widget.tsx',
        undefined,
      )
      expect(result).toBeNull()
    })

    it('passes a file through unstamped rather than throwing on a syntax error', () => {
      const plugin = voxfold()
      const brokenCode = `function App() { return <p>unterminated`
      expect(() =>
        callHook(plugin.transform, brokenCode, '/project/src/Broken.tsx', undefined),
      ).not.toThrow()
      const result = callHook(plugin.transform, brokenCode, '/project/src/Broken.tsx', undefined)
      expect(result).toBeNull()
    })
  })
})
