import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtractContext, LanguageAdapter, NodeRef, ProseDocument } from '@voxfold/core'

/**
 * Both adapters used in this package's tests (markdown, HTML) extract synchronously; the shared
 * `LanguageAdapter` type allows `Promise<ProseDocument>` for adapters that need it (a future async
 * one), so callers that know they're using a sync adapter cast, matching the same pattern the
 * adapters' own test suites use.
 */
export function extractSync(
  adapter: LanguageAdapter,
  text: string,
  context: ExtractContext,
): ProseDocument {
  return adapter.extract(text, context) as ProseDocument
}

/** A fresh git repo in a temp dir, with one file committed so the git guard passes. */
export function makeTrackedRepo(fileName: string, content: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'vx-writer-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  const file = join(dir, fileName)
  writeFileSync(file, content, 'utf8')
  execFileSync('git', ['add', fileName], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir })
  return { dir, file }
}

/**
 * Reset an already-tracked file back to `content` without re-running `git init`/`commit`. The
 * writer's git guard only checks `git ls-files` (is this path tracked at all), not working-tree
 * cleanliness, so a file can be rewritten and re-used across many iterations of the same repo —
 * useful for fuzzing, where a fresh `git init` per iteration would dominate the run time.
 */
export function resetTrackedFile(file: string, content: string): void {
  writeFileSync(file, content, 'utf8')
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

/** Find the first editable text segment whose flat text contains `needle`, with its NodeRef. */
export function findSegment(
  document: ProseDocument,
  needle: string,
): { ref: NodeRef; oldText: string } {
  for (const block of document.blocks) {
    const index = block.text.indexOf(needle)
    if (index === -1) continue
    for (const segment of block.segments) {
      if (segment.kind !== 'text' || !segment.node || !segment.editable) continue
      if (index >= segment.flatStart && index + needle.length <= segment.flatEnd) {
        // The segment's own decoded text, not the block's flattened text: for a `text` mdast/DOM
        // node, flatStart..flatEnd within the block corresponds 1:1 to the node's own value only
        // when the segment covers the WHOLE node text (true for every fixture here, since none
        // spans a partial word across a segment boundary).
        return { ref: segment.node, oldText: block.text.slice(segment.flatStart, segment.flatEnd) }
      }
    }
  }
  throw new Error(`no editable segment found containing ${JSON.stringify(needle)}`)
}
