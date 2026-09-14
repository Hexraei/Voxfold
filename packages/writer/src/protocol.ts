/**
 * The verify-then-write protocol. Every step must pass or the whole request is refused with a
 * typed `WriteError` — nothing is ever partially written. Steps mirror the build plan's numbered
 * list; the comment on each names which one it is so the plan and the code can be read side by
 * side.
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { LocatedNode } from '@voxfold/core'
import { WriteError, type WriteErrorCode } from './errors.ts'
import { assertGitTracked, excludeVoxfoldDir } from './guards/git.ts'
import { assertPathAllowed } from './guards/path.ts'
import { sha256 } from './hash.ts'
import { minimalDiff } from './minimal-diff.ts'
import type { EditRequest, WriteOptions, WriteResult } from './types.ts'

const DEFAULT_MAX_HISTORY = 100

/** Source offset of decoded index `i`, using the charMap when present, else a linear offset. */
function sourceOffsetAt(located: LocatedNode, i: number): number {
  if (located.charMap) {
    // One past the last mapped char (the end of the value) has no charMap entry of its own.
    if (i < located.charMap.length) return located.charMap[i]!
    return located.valueRange.end
  }
  return located.valueRange.start + i
}

/**
 * Adapter hooks are third-party code from the writer protocol's point of view (a different
 * package, sometimes a third-party rule pack's own adapter): a bug there — an out-of-range path,
 * an assertion inside `locate` — must surface as a refusal, never an uncaught exception that
 * skips the atomic-write guarantee this module exists to provide.
 */
function callAdapterHook<T>(step: WriteErrorCode, run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof WriteError) throw error
    throw new WriteError(step, `adapter writer hook failed: ${(error as Error).message}`)
  }
}

/**
 * Apply one target's patch to `source`, returning the new source text.
 *
 * Steps 4-7: locate and assert the old text matches, compute the minimal changed span, map it to
 * source offsets, and refuse if that span would touch anything outside the value's own range.
 */
function applyOneEdit(
  source: string,
  ast: unknown,
  adapterWriter: NonNullable<import('@voxfold/core').LanguageAdapter['writer']>,
  target: { ref: import('@voxfold/core').NodeRef; expectedOldText: string; newText: string },
): { patched: string; spanStart: number; spanEnd: number } {
  const located = callAdapterHook('TargetMismatch', () => adapterWriter.locate(ast, target.ref))

  // Step 4: the node's decoded value must be exactly what the caller expected. A mismatch means
  // the file changed underneath the request in a way the hash check alone didn't catch (e.g. the
  // same file content but a different parse — should not happen, but this is the last line of
  // defense before anything is written) or the ref pointed at the wrong node entirely.
  if (located.decoded !== target.expectedOldText) {
    throw new WriteError(
      'TargetMismatch',
      `node at "${target.ref.path}" has text ${JSON.stringify(located.decoded)}, ` +
        `expected ${JSON.stringify(target.expectedOldText)}`,
    )
  }
  if (located.nodeType !== target.ref.type) {
    throw new WriteError(
      'TargetMismatch',
      `node at "${target.ref.path}" is a ${located.nodeType}, expected ${target.ref.type}`,
    )
  }
  // `valueRange` must itself be consistent with `decoded` and `charMap` before it's trusted for
  // any offset math below — an inflated or shrunk range that happens not to move the computed
  // patch span (e.g. no charMap, so only interior offsets are ever used) would otherwise pass
  // silently. When there's no charMap the mapping is declared linear, so the range's width must
  // equal the decoded length exactly; when there is one, the range must bound every entry in it.
  const rangeWidth = located.valueRange.end - located.valueRange.start
  if (!located.charMap && rangeWidth !== located.decoded.length) {
    throw new WriteError(
      'OutOfBounds',
      `node at "${target.ref.path}": valueRange width ${rangeWidth} does not match ` +
        `decoded length ${located.decoded.length} with no charMap`,
    )
  }
  if (
    located.charMap?.some(
      (offset) => offset < located.valueRange.start || offset >= located.valueRange.end,
    )
  ) {
    throw new WriteError(
      'OutOfBounds',
      `node at "${target.ref.path}": charMap has an entry outside its own valueRange`,
    )
  }

  // Step 5: minimal patch. Only the changed middle is encoded and written.
  const diff = minimalDiff(target.expectedOldText, target.newText)
  const encodedMiddle = callAdapterHook('OutOfBounds', () =>
    adapterWriter.encode(diff.changedNew, located),
  )

  const spanStart = sourceOffsetAt(located, diff.prefixEnd)
  const spanEnd = sourceOffsetAt(located, diff.suffixStart)

  // Step 6: the patch must sit strictly inside the value's own range, never touching delimiters
  // (markdown `**`, an HTML tag, a JSX brace) that the value's own text doesn't include.
  if (
    spanStart < located.valueRange.start ||
    spanEnd > located.valueRange.end ||
    spanStart > spanEnd
  ) {
    throw new WriteError(
      'OutOfBounds',
      `patch for "${target.ref.path}" would span [${spanStart}, ${spanEnd}), ` +
        `outside its value range [${located.valueRange.start}, ${located.valueRange.end})`,
    )
  }

  const patched = source.slice(0, spanStart) + encodedMiddle + source.slice(spanEnd)
  return { patched, spanStart, spanEnd: spanStart + encodedMiddle.length }
}

/**
 * Apply every target in a request to `source` in one pass, refusing the whole batch if any single
 * edit fails at any step. Targets are applied right-to-left by source position so earlier offsets
 * stay valid as later ones shift the text.
 */
function applyAllEdits(
  source: string,
  ast: unknown,
  adapterWriter: NonNullable<import('@voxfold/core').LanguageAdapter['writer']>,
  targets: EditRequest['targets'],
): string {
  if (targets.length === 0) throw new WriteError('NoEdits', 'no edits in this request')

  const located = targets.map((target) => ({
    target,
    range: callAdapterHook('TargetMismatch', () => adapterWriter.locate(ast, target.ref))
      .valueRange,
  }))
  const sorted = [...located].sort((a, b) => b.range.start - a.range.start)

  // Overlapping targets could each compute a valid patch in isolation but corrupt the file when
  // applied together, since the second patch's offsets would be stale after the first one shifts
  // the text. Two edits are only safe together when their value ranges don't overlap at all.
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.range.end > sorted[i - 1]!.range.start) {
      throw new WriteError(
        'OverlappingEdits',
        `edits for "${sorted[i]!.target.ref.path}" and "${sorted[i - 1]!.target.ref.path}" overlap`,
      )
    }
  }

  let text = source
  for (const { target } of sorted) {
    const result = applyOneEdit(text, ast, adapterWriter, target)
    text = result.patched
  }
  return text
}

function writeHistoryEntry(
  historyDir: string,
  originalContent: string,
  file: string,
  maxEntries: number,
): string {
  mkdirSync(historyDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const entryFile = join(historyDir, `${stamp}-${sha256(originalContent).slice(0, 12)}.json`)
  writeFileSync(
    entryFile,
    JSON.stringify({ file, timestamp: stamp, content: originalContent }, null, 2),
  )

  const entries = readdirSync(historyDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
  const excess = entries.length - maxEntries
  for (let i = 0; i < excess; i++) unlinkSync(join(historyDir, entries[i]!))

  return entryFile
}

/**
 * If the original file used CRLF exclusively, normalize any bare `\n` the patch introduced.
 * `encode()` should never introduce a newline at all for the rules this ships with (mechanical
 * fixes are word-level replacements), but this keeps the file's line-ending style intact even if
 * a future encoder or fix is careless about it.
 */
function matchLineEndings(original: string, patched: string): string {
  const hasCrlf = original.includes('\r\n')
  const hasBareLf = /(?<!\r)\n/.test(original)
  if (!hasCrlf || hasBareLf) return patched
  return patched.replace(/(?<!\r)\n/g, '\r\n')
}

/** Write `content` to `file` atomically: temp file in the same directory, then rename. */
function atomicWrite(file: string, content: string): void {
  const tmp = `${file}.voxfold-tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, file)
}

export function applyEditRequest(request: EditRequest, options: WriteOptions = {}): WriteResult {
  const projectRoot = options.projectRoot ?? process.cwd()
  const historyDir = options.historyDir ?? join(projectRoot, '.voxfold', 'history')
  const maxHistory = options.maxHistoryEntries ?? DEFAULT_MAX_HISTORY

  // Step 1: path guard.
  assertPathAllowed(request.file, projectRoot)

  const adapterWriter = request.adapter.writer
  if (!adapterWriter) {
    throw new WriteError(
      'UnsupportedExtension',
      `${request.adapter.id}: this adapter has no writer`,
    )
  }

  // Step 2: git guard.
  if (!options.allowUntracked) assertGitTracked(request.file)

  // Step 3: read and hash-check the source.
  const source = readFileSync(request.file, 'utf8')
  const actualHash = sha256(source)
  if (actualHash !== request.expectedFileHash) {
    throw new WriteError(
      'StaleSource',
      `${request.file}: on-disk content has changed since it was read ` +
        `(expected sha256 ${request.expectedFileHash}, found ${actualHash})`,
    )
  }

  // Step 4-6: parse, locate each target, verify, compute and bound the minimal patch.
  const originalAst = callAdapterHook('ReparseFailed', () => adapterWriter.parse(source))
  const patched = applyAllEdits(source, originalAst, adapterWriter, request.targets)

  // Step 7: everything outside the touched spans must be byte-identical. Enforced by construction
  // here (applyAllEdits only ever slices and splices around the exact spans it computed), but the
  // fault-injection suite double-checks this by comparing prefix/suffix runs directly.

  // Step 8: re-parse the patched text; a syntax error means the encoder produced something the
  // format can't actually represent.
  let reparsedAst: unknown
  try {
    reparsedAst = adapterWriter.parse(patched)
  } catch (error) {
    throw new WriteError(
      'ReparseFailed',
      `${request.file}: patched text does not parse: ${(error as Error).message}`,
    )
  }

  // Step 9: structure must be unchanged apart from the targeted values, and each target's new
  // value must read back exactly as intended. A `locate`/`fingerprint` call that throws here
  // (rather than returning a mismatched value) is just as much a sign the patch broke the
  // target's structure, so it is treated the same as a value mismatch, not a crash.
  const maskedRefs = request.targets.map((t) => t.ref)
  const beforeFingerprint = callAdapterHook('UnexpectedChange', () =>
    adapterWriter.fingerprint(originalAst, maskedRefs),
  )
  const afterFingerprint = callAdapterHook('UnexpectedChange', () =>
    adapterWriter.fingerprint(reparsedAst, maskedRefs),
  )
  if (beforeFingerprint !== afterFingerprint) {
    throw new WriteError(
      'UnexpectedChange',
      `${request.file}: patch changed more than the targeted text (fingerprint mismatch)`,
    )
  }
  for (const target of request.targets) {
    const after = callAdapterHook('UnexpectedChange', () =>
      adapterWriter.locate(reparsedAst, target.ref),
    )
    if (after.decoded !== target.newText) {
      throw new WriteError(
        'UnexpectedChange',
        `${request.file}: "${target.ref.path}" reads back as ${JSON.stringify(after.decoded)}, ` +
          `expected ${JSON.stringify(target.newText)}`,
      )
    }
  }

  // Step 10: re-run extract and check the target block's flat text, when the adapter can tell us
  // — left to the caller (writer.ts's applyFix), since only it knows which block a target came
  // from and what flat text to expect. The protocol here guarantees the source-level contract;
  // the round-trip-through-extract check is a second, independent proof for the common case.

  // Step 11: preserve line endings (steps 8-9 already prove no bytes outside the patch moved, so
  // BOM and trailing newline survive automatically; only the encoder's own newline style needs
  // normalizing, since an encoder must never introduce a bare \n into a CRLF file).
  const finalText = matchLineEndings(source, patched)

  // Step 12: atomic write, plus an undo entry recording the pre-write content.
  const historyFile = writeHistoryEntry(historyDir, source, request.file, maxHistory)
  excludeVoxfoldDir(request.file)
  atomicWrite(request.file, finalText)

  return { newHash: sha256(finalText), newText: finalText, historyFile }
}
