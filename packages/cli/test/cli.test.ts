import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXIT_FATAL, EXIT_GATE_FAILED, EXIT_OK } from '../src/exit-codes'

// The CLI writes its report to stdout/stderr and communicates status via exit code, so tests
// capture both rather than asserting on return values that don't otherwise exist.
async function runCli(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { run } = await import('../src/cli')
  let stdout = ''
  let stderr = ''
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += chunk
    return true
  })
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += chunk
    return true
  })
  const originalExitCode = process.exitCode
  process.exitCode = undefined
  try {
    const exitCode = await run(['node', 'voxfold', ...args])
    return { exitCode, stdout, stderr }
  } finally {
    outSpy.mockRestore()
    errSpy.mockRestore()
    process.exitCode = originalExitCode
  }
}

describe('voxfold CLI', () => {
  let dir: string
  let originalCwd: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voxfold-cli-'))
    originalCwd = process.cwd()
    process.chdir(dir)
  })
  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(dir, { recursive: true, force: true })
  })

  // The first test in this file pays the one-time cost of dynamically importing ../src/cli
  // (module graph resolution) while the whole workspace's test files are starting up in
  // parallel — observed to occasionally cross the 5s default under that contention even though
  // the test itself does very little work. 10s of headroom, not a slow test.
  it('reports flags and a score for a file with tells', async () => {
    writeFileSync(
      'README.md',
      'We utilize a robust platform that truly empowers every single team we work with today. '.repeat(
        8,
      ),
    )
    const { exitCode, stdout } = await runCli(['README.md'])
    expect(exitCode).toBe(EXIT_OK)
    expect(stdout).toContain('utilize')
    expect(stdout).toContain('Style score:')
  }, 10_000)

  it('exits 2 when no lintable files are found', async () => {
    const { exitCode, stderr } = await runCli(['nonexistent-pattern-*.md'])
    expect(exitCode).toBe(EXIT_FATAL)
    expect(stderr).toContain('No lintable files found')
  })

  it('exits 1 when --min-score is not met, 0 when it is', async () => {
    writeFileSync('README.md', 'We utilize a robust seamlessly empowering platform. '.repeat(20))
    const failing = await runCli(['README.md', '--min-score', '99', '--quiet'])
    expect(failing.exitCode).toBe(EXIT_GATE_FAILED)

    const passing = await runCli(['README.md', '--min-score', '0', '--quiet'])
    expect(passing.exitCode).toBe(EXIT_OK)
  })

  it('--format json emits schema-versioned, parseable JSON with the score', async () => {
    writeFileSync(
      'README.md',
      'We utilize modern tooling here and there today, always. '.repeat(15),
    )
    const { stdout, exitCode } = await runCli(['README.md', '--format', 'json'])
    expect(exitCode).toBe(EXIT_OK)
    const payload = JSON.parse(stdout)
    expect(payload.schemaVersion).toBe(1)
    expect(payload.files[0].path).toBe('README.md')
    expect(payload.files[0].flags.some((f: { ruleId: string }) => f.ruleId === 'utilize')).toBe(
      true,
    )
  })

  it('rejects an unknown --format', async () => {
    writeFileSync('README.md', '# x')
    const { exitCode, stderr } = await runCli(['README.md', '--format', 'yaml'])
    expect(exitCode).toBe(EXIT_FATAL)
    expect(stderr).toContain('Unknown format')
  })

  it('--rule overrides a rule severity from the command line', async () => {
    writeFileSync(
      'README.md',
      'We utilize modern tooling constantly across every single team. '.repeat(10),
    )
    const withRule = await runCli(['README.md', '--format', 'json'])
    const withoutRule = await runCli(['README.md', '--format', 'json', '--rule', 'utilize:off'])
    const flagsWith = JSON.parse(withRule.stdout).files[0].flags
    const flagsWithout = JSON.parse(withoutRule.stdout).files[0].flags
    expect(flagsWith.some((f: { ruleId: string }) => f.ruleId === 'utilize')).toBe(true)
    expect(flagsWithout.some((f: { ruleId: string }) => f.ruleId === 'utilize')).toBe(false)
  })

  it('a config file rule override is picked up automatically, and --no-config-lookup skips it', async () => {
    writeFileSync(
      'README.md',
      'We utilize modern tooling constantly across every single team. '.repeat(10),
    )
    writeFileSync('voxfold.config.mjs', 'export default [{ rules: { utilize: "off" } }]\n')

    const withConfig = await runCli(['README.md', '--format', 'json'])
    const flagsWithConfig = JSON.parse(withConfig.stdout).files[0].flags
    expect(flagsWithConfig.some((f: { ruleId: string }) => f.ruleId === 'utilize')).toBe(false)

    const withoutConfig = await runCli(['README.md', '--format', 'json', '--no-config-lookup'])
    const flagsWithoutConfig = JSON.parse(withoutConfig.stdout).files[0].flags
    expect(flagsWithoutConfig.some((f: { ruleId: string }) => f.ruleId === 'utilize')).toBe(true)
  })

  describe('--fix', () => {
    it('applies a fix on disk and does not touch unrelated text', async () => {
      const before =
        'Intro paragraph, quite plain and unrelated to anything else in this test.\n\n' +
        'We utilize modern tooling here for everything that we build every day.\n'
      writeFileSync('README.md', before)
      const { stdout } = await runCli(['README.md', '--fix'])
      expect(stdout).toContain('Fixed')
      const after = readFileSync('README.md', 'utf8')
      expect(after).toBe(before.replace('utilize', 'use'))
    })

    it('--fix-dry-run reports what would change without writing', async () => {
      const before =
        'We utilize modern tooling here for everything that we build every single day.\n'
      writeFileSync('README.md', before)
      const { stdout } = await runCli(['README.md', '--fix-dry-run'])
      expect(stdout).toContain('Would fix')
      expect(readFileSync('README.md', 'utf8')).toBe(before)
    })
  })

  describe('suppressions', () => {
    it('--suppress-rule writes an entry that a later run honors', async () => {
      writeFileSync(
        'README.md',
        'We utilize a robust platform that truly empowers every single team we serve today.\n'.repeat(
          3,
        ),
      )
      await runCli(['README.md', '--suppress-rule', 'robust', '--quiet'])
      const suppressions = JSON.parse(readFileSync('voxfold-suppressions.json', 'utf8'))
      expect(suppressions.files['README.md']).toHaveLength(1)
      expect(suppressions.files['README.md'][0].rule).toBe('robust')

      const { stdout } = await runCli(['README.md', '--format', 'json'])
      const flags = JSON.parse(stdout).files[0].flags
      expect(flags.some((f: { ruleId: string }) => f.ruleId === 'robust')).toBe(false)
      // Other rules on the same text still fire; suppression is per rule, not per file.
      expect(flags.some((f: { ruleId: string }) => f.ruleId === 'utilize')).toBe(true)
    })

    it('running --suppress-rule twice does not duplicate the entry', async () => {
      writeFileSync(
        'README.md',
        'We utilize a robust platform constantly, every single day, without fail.\n'.repeat(3),
      )
      await runCli(['README.md', '--suppress-rule', 'robust', '--quiet'])
      await runCli(['README.md', '--suppress-rule', 'robust', '--quiet'])
      const suppressions = JSON.parse(readFileSync('voxfold-suppressions.json', 'utf8'))
      expect(suppressions.files['README.md']).toHaveLength(1)
    })

    it('--prune-suppressions removes a stale entry but keeps one whose flag still fires', async () => {
      writeFileSync(
        'README.md',
        'We utilize a robust platform constantly, every single day, without fail.\n'.repeat(3),
      )
      writeFileSync(
        'voxfold-suppressions.json',
        JSON.stringify({
          version: 1,
          files: {
            'README.md': [
              { rule: 'robust', hash: 'placeholder' },
              { rule: 'stale-rule', hash: 'deadbeef' },
            ],
          },
        }),
      )
      // Overwrite the placeholder hash with the real one by suppressing for real first.
      await runCli(['README.md', '--suppress-rule', 'robust', '--quiet'])
      writeFileSync(
        'voxfold-suppressions.json',
        (() => {
          const current = JSON.parse(readFileSync('voxfold-suppressions.json', 'utf8'))
          current.files['README.md'].push({ rule: 'stale-rule', hash: 'deadbeef' })
          return JSON.stringify(current)
        })(),
      )

      await runCli(['README.md', '--prune-suppressions', '--quiet'])
      const after = JSON.parse(readFileSync('voxfold-suppressions.json', 'utf8'))
      const rules = after.files['README.md'].map((e: { rule: string }) => e.rule)
      expect(rules).toContain('robust')
      expect(rules).not.toContain('stale-rule')
    })
  })

  describe('--ignore-pattern and .gitignore', () => {
    it('lints only files not excluded by .gitignore or --ignore-pattern', async () => {
      writeFileSync('.gitignore', 'skip-me.md\n')
      writeFileSync('skip-me.md', 'We utilize modern tooling here for everything constantly.\n')
      writeFileSync('also-skip.md', 'We utilize modern tooling here for everything constantly.\n')
      writeFileSync('keep.md', 'Plain text with nothing notable in it at all, just words.\n')

      const { stdout } = await runCli(['.', '--ignore-pattern', 'also-skip.md', '--format', 'json'])
      const paths = JSON.parse(stdout).files.map((f: { path: string }) => f.path)
      expect(paths).toEqual(['keep.md'])
    })
  })
})
