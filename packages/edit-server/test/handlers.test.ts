import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { jsxAdapter } from '@voxfold/lang-jsx'
import { recommended } from '@voxfold/rules-recommended'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply,
  type EditServerContext,
  EditServerError,
  lintFile,
  openInEditor,
  plan,
  resolve,
  suppress,
  undo,
} from '../src/handlers.ts'
import { StampRegistry } from '../src/registry.ts'
import { cleanup, makeTrackedRepo } from './helpers.ts'

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) cleanup(dir)
})

/** Set up a repo with one .tsx file, stamp it, and build a context ready for the handlers. */
function setup(content: string) {
  const { dir, file } = makeTrackedRepo('Hero.tsx', content)
  dirs.push(dir)
  const relativePath = 'Hero.tsx'

  const registry = new StampRegistry([jsxAdapter])
  const stamped = jsxAdapter.stamp!(content, { uri: relativePath, relativePath })
  registry.update(relativePath, 'jsx', sha256(content), stamped.entries)

  const ctx: EditServerContext = {
    registry,
    projectRoot: dir,
    ruleset: recommended,
    suppressionsPath: join(dir, 'voxfold-suppressions.json'),
    allowedRoot: dir,
  }

  return { dir, file, relativePath, registry, ctx, stampId: stamped.entries[0]!.id }
}

describe('resolve', () => {
  it('returns the refs for a known stamp id', () => {
    const content = 'export const x = <p>We utilize a robust plan for everyone here.</p>\n'
    const { ctx, stampId } = setup(content)

    const result = resolve(ctx, { stampId })
    expect(result.relativePath).toBe('Hero.tsx')
    expect(result.refs.length).toBeGreaterThan(0)
    expect(result.refs.every((r) => r.editable)).toBe(true)
  })

  it('throws UnknownStamp for an id that was never stamped', () => {
    const { ctx } = setup('export const x = <p>We utilize a robust plan for everyone here.</p>\n')
    try {
      resolve(ctx, { stampId: 'not-a-real-id' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(EditServerError)
      expect((error as EditServerError).code).toBe('UnknownStamp')
    }
  })
})

describe('plan', () => {
  it('accepts a root with a trailing separator without weakening containment', async () => {
    const { ctx, relativePath } = setup('export const x = <p>Hello</p>\n')
    ctx.allowedRoot = `${ctx.allowedRoot}/`
    await expect(lintFile(ctx, { relativePath })).resolves.toBeDefined()
    await expect(lintFile(ctx, { relativePath: '../outside.tsx' })).rejects.toMatchObject({
      code: 'PathNotAllowed',
    })
  })

  it('returns the diff for a valid edit without writing anything', async () => {
    const content = 'export const x = <p>We utilize a robust plan for everyone here.</p>\n'
    const { ctx, relativePath, stampId, file } = setup(content)
    const { refs } = resolve(ctx, { stampId })
    const target = refs.find((r) => r.ref.type === 'JSXText')!

    const result = await plan(ctx, {
      relativePath,
      targets: [
        {
          ref: target.ref,
          expectedOldText: 'We utilize a robust plan for everyone here.',
          newText: 'We use a robust plan for everyone here.',
        },
      ],
    })

    expect(result.diffs).toHaveLength(1)
    expect(result.diffs[0]!.newText).toBe('We use a robust plan for everyone here.')
    expect(readFileSync(file, 'utf8')).toBe(content)
  })

  it('refuses a plan whose expected old text no longer matches', async () => {
    const content = 'export const x = <p>We utilize a robust plan for everyone here.</p>\n'
    const { ctx, relativePath, stampId } = setup(content)
    const { refs } = resolve(ctx, { stampId })
    const target = refs.find((r) => r.ref.type === 'JSXText')!

    try {
      await plan(ctx, {
        relativePath,
        targets: [{ ref: target.ref, expectedOldText: 'this is not the real text', newText: 'x' }],
      })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(EditServerError)
      expect((error as EditServerError).code).toBe('StaleTarget')
    }
  })
})

describe('apply', () => {
  it('writes the edit through the full writer protocol', async () => {
    const content = 'export const x = <p>We utilize a robust plan for everyone here.</p>\n'
    const { ctx, relativePath, stampId, file } = setup(content)
    const { refs } = resolve(ctx, { stampId })
    const target = refs.find((r) => r.ref.type === 'JSXText')!

    const result = await apply(ctx, {
      relativePath,
      expectedFileHash: sha256(content),
      targets: [
        {
          ref: target.ref,
          expectedOldText: 'We utilize a robust plan for everyone here.',
          newText: 'We use a robust plan for everyone here.',
        },
      ],
    })

    expect(readFileSync(file, 'utf8')).toBe(result.newText)
    expect(result.newText).toContain('We use a robust plan')
  })

  it('refuses a path the registry never stamped', async () => {
    const content = 'export const x = <p>We utilize a robust plan for everyone here.</p>\n'
    const { ctx } = setup(content)

    try {
      await apply(ctx, {
        relativePath: 'Other.tsx',
        expectedFileHash: sha256(content),
        targets: [],
      })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(EditServerError)
      expect((error as EditServerError).code).toBe('PathNotAllowed')
    }
  })

  it('refuses a path outside the project root even if it happens to be requested', async () => {
    const content = 'export const x = <p>We utilize a robust plan for everyone here.</p>\n'
    const { ctx } = setup(content)

    try {
      await apply(ctx, {
        relativePath: '../../etc/passwd',
        expectedFileHash: sha256(content),
        targets: [],
      })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(EditServerError)
      expect((error as EditServerError).code).toBe('PathNotAllowed')
    }
  })
})

describe('undo', () => {
  it('restores the file after an apply', async () => {
    const content = 'export const x = <p>We utilize a robust plan for everyone here.</p>\n'
    const { ctx, relativePath, stampId, file } = setup(content)
    const { refs } = resolve(ctx, { stampId })
    const target = refs.find((r) => r.ref.type === 'JSXText')!

    await apply(ctx, {
      relativePath,
      expectedFileHash: sha256(content),
      targets: [
        {
          ref: target.ref,
          expectedOldText: 'We utilize a robust plan for everyone here.',
          newText: 'We use a robust plan for everyone here.',
        },
      ],
    })
    expect(readFileSync(file, 'utf8')).not.toBe(content)

    await undo(ctx, { relativePath })
    expect(readFileSync(file, 'utf8')).toBe(content)
  })
})

describe('suppress', () => {
  it('writes a suppression entry to the suppressions file', async () => {
    const content = 'export const x = <p>We utilize a robust plan for everyone here.</p>\n'
    const { ctx, relativePath } = setup(content)

    await suppress(ctx, { relativePath, ruleId: 'utilize', hash: 'abc123' })

    const written = JSON.parse(readFileSync(ctx.suppressionsPath, 'utf8'))
    expect(written.files[relativePath]).toEqual([{ rule: 'utilize', hash: 'abc123' }])
  })

  it('does not duplicate an entry written twice', async () => {
    const content = 'export const x = <p>We utilize a robust plan for everyone here.</p>\n'
    const { ctx, relativePath } = setup(content)

    await suppress(ctx, { relativePath, ruleId: 'utilize', hash: 'abc123' })
    await suppress(ctx, { relativePath, ruleId: 'utilize', hash: 'abc123' })

    const written = JSON.parse(readFileSync(ctx.suppressionsPath, 'utf8'))
    expect(written.files[relativePath]).toHaveLength(1)
  })
})

describe('lintFile', () => {
  it('lints the current on-disk content of a known file', async () => {
    const content =
      'export const x = <p>We utilize a robust plan every day for our whole growing team here.</p>\n'
    const { ctx, relativePath } = setup(content)

    const result = await lintFile(ctx, { relativePath })
    expect(result.flags.some((f) => f.ruleId === 'utilize')).toBe(true)
  })
})

describe('openInEditor', () => {
  it('refuses a path the registry never stamped, before attempting to launch anything', async () => {
    const content = 'export const x = <p>We utilize a robust plan for everyone here.</p>\n'
    const { ctx } = setup(content)

    try {
      await openInEditor(ctx, { relativePath: 'Other.tsx' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(EditServerError)
      expect((error as EditServerError).code).toBe('PathNotAllowed')
    }
  })

  it('refuses a path outside the project root', async () => {
    const content = 'export const x = <p>We utilize a robust plan for everyone here.</p>\n'
    const { ctx } = setup(content)

    try {
      await openInEditor(ctx, { relativePath: '../../etc/passwd' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(EditServerError)
      expect((error as EditServerError).code).toBe('PathNotAllowed')
    }
  })
})
