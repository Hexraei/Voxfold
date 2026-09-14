/**
 * @voxfold/writer — the only way any part of Voxfold edits a source file.
 *
 * `applyEditRequest` runs a fixed, format-agnostic verify-then-write protocol: path and git
 * guards, a hash check against stale reads, re-parsing and asserting the exact old text before
 * touching anything, a minimal patch bounded strictly inside the target's own value range,
 * re-parsing the result and comparing structure fingerprints before and after, then an atomic
 * write with an undo entry. Any step failing refuses the whole request with a typed `WriteError`
 * — never a partial write.
 */

export { isWriteError, WriteError, type WriteErrorCode } from './errors.ts'
export { type MinimalDiff, minimalDiff } from './minimal-diff.ts'
export { applyEditRequest } from './protocol.ts'
export type { EditRequest, EditTarget, WriteOptions, WriteResult } from './types.ts'
export { readHistoryEntry, undoLast } from './undo.ts'
