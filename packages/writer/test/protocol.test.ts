import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { markdownAdapter } from '@voxfold/lang-markdown'
import { afterEach, describe, expect, it } from 'vitest'
import { WriteError } from '../src/errors.ts'
import { sha256 } from '../src/hash.ts'
import { applyEditRequest } from '../src/protocol.ts'
import { cleanup, extractSync, findSegment, makeTrackedRepo } from './helpers.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) cleanup(dir)
})

function setup(content: string) {
  const { dir, file } = makeTrackedRepo('doc.md', content)
  dirs.push(dir)
  return { dir, file }
}

describe('applyEditRequest: happy path', () => {
  it('applies a simple word replacement and returns the new hash', () => {
    const content =
      'We utilize a robust platform every day, and it works well for our whole team.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: markdownAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('utilize', 'use'))
    expect(result.newHash).toBe(sha256(result.newText))
    expect(readFileSync(file, 'utf8')).toBe(result.newText)
  })

  it('patches only the minimal changed span, leaving surrounding punctuation untouched', () => {
    const content = 'Our platform, which is robust, ships fast and works well for everyone here.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'robust')

    const result = applyEditRequest(
      {
        file,
        adapter: markdownAdapter,
        expectedFileHash: sha256(content),
        targets: [
          { ref, expectedOldText: oldText, newText: oldText.replace('robust', 'reliable') },
        ],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('robust', 'reliable'))
  })

  it('applies an edit inside bold text without disturbing the ** markers', () => {
    const content =
      'Some intro paragraph with plenty of its own words to satisfy any length check.\n\n' +
      'We **utilize** modern tooling for absolutely everything that we build here.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: markdownAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    expect(result.newText).toBe(content.replace('**utilize**', '**use**'))
  })

  it('writes a history entry that can restore the original content', () => {
    const content = 'We utilize a robust platform every day for our whole growing team here.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    const result = applyEditRequest(
      {
        file,
        adapter: markdownAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir, historyDir: join(dir, '.voxfold', 'history') },
    )

    expect(result.historyFile).toBeDefined()
    const entry = JSON.parse(readFileSync(result.historyFile!, 'utf8'))
    expect(entry.content).toBe(content)
  })

  it('excludes .voxfold/ from git status via .git/info/exclude', () => {
    const content = 'We utilize a robust platform every day for our whole growing team here.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    applyEditRequest(
      {
        file,
        adapter: markdownAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir },
    )

    const status = execFileSync('git', ['status', '--short'], { cwd: dir }).toString()
    expect(status).not.toContain('.voxfold')
    const exclude = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude).toMatch(/^\.voxfold\/?$/m)
  })
})

describe('applyEditRequest: refusals', () => {
  it('refuses a stale file hash', () => {
    const content = 'We utilize a robust platform every day for our whole growing team here.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    try {
      applyEditRequest(
        {
          file,
          adapter: markdownAdapter,
          expectedFileHash: 'not-the-real-hash',
          targets: [{ ref, expectedOldText: oldText, newText: 'use' }],
        },
        { projectRoot: dir },
      )
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(WriteError)
      expect((error as WriteError).code).toBe('StaleSource')
    }
  })

  it('refuses when the expected old text no longer matches', () => {
    const content = 'We utilize a robust platform every day for our whole growing team here.\n'
    const { file, dir } = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref } = findSegment(document, 'utilize')

    try {
      applyEditRequest(
        {
          file,
          adapter: markdownAdapter,
          expectedFileHash: sha256(content),
          targets: [{ ref, expectedOldText: 'this is not the real text', newText: 'use' }],
        },
        { projectRoot: dir },
      )
      expect.unreachable()
    } catch (error) {
      expect((error as WriteError).code).toBe('TargetMismatch')
    }
  })

  it('refuses an untracked file unless allowUntracked is set', () => {
    const content = 'We utilize a robust platform every day for our whole growing team here.\n'
    const { dir } = setup(content)
    const untracked = join(dir, 'scratch.md')
    writeFileSync(untracked, content, 'utf8')
    const document = extractSync(markdownAdapter, content, { uri: untracked })
    const { ref, oldText } = findSegment(document, 'utilize')

    try {
      applyEditRequest(
        {
          file: untracked,
          adapter: markdownAdapter,
          expectedFileHash: sha256(content),
          targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
        },
        { projectRoot: dir },
      )
      expect.unreachable()
    } catch (error) {
      expect((error as WriteError).code).toBe('UntrackedFile')
    }

    const result = applyEditRequest(
      {
        file: untracked,
        adapter: markdownAdapter,
        expectedFileHash: sha256(content),
        targets: [{ ref, expectedOldText: oldText, newText: oldText.replace('utilize', 'use') }],
      },
      { projectRoot: dir, allowUntracked: true },
    )
    expect(result.newText).toContain('use a robust')
  })

  it('refuses a path outside the project root', () => {
    const content = 'We utilize a robust platform every day for our whole growing team here.\n'
    const { file } = setup(content)
    const other = setup(content)
    const document = extractSync(markdownAdapter, content, { uri: file })
    const { ref, oldText } = findSegment(document, 'utilize')

    try {
      applyEditRequest(
        {
          file,
          adapter: markdownAdapter,
          expectedFileHash: sha256(content),
          targets: [{ ref, expectedOldText: oldText, newText: 'use' }],
        },
        // `file` sits in its own repo, entirely outside `other.dir` — a different real directory
        // on disk, not just a different path string, so the realpath comparison is meaningful.
        { projectRoot: other.dir },
      )
      expect.unreachable()
    } catch (error) {
      expect((error as WriteError).code).toBe('PathOutsideProject')
    }
  })

  it('refuses a request with no targets', () => {
    const content = 'We utilize a robust platform every day for our whole growing team here.\n'
    const { file, dir } = setup(content)

    try {
      applyEditRequest(
        {
          file,
          adapter: markdownAdapter,
          expectedFileHash: sha256(content),
          targets: [],
        },
        { projectRoot: dir },
      )
      expect.unreachable()
    } catch (error) {
      expect((error as WriteError).code).toBe('NoEdits')
    }
  })
})
