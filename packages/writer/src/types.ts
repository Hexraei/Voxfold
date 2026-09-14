import type { LanguageAdapter, NodeRef } from '@voxfold/core'

/**
 * One text segment to change, identified by the `NodeRef` the adapter attached when it built the
 * `ProseDocument` this edit was planned against.
 */
export interface EditTarget {
  ref: NodeRef
  /** The segment's decoded text as `extract` reported it, checked against a fresh parse. */
  expectedOldText: string
  newText: string
}

export interface EditRequest {
  /** Absolute path to the file on disk. */
  file: string
  adapter: LanguageAdapter
  /** sha256 of the file's current on-disk content, from when it was last read. */
  expectedFileHash: string
  targets: EditTarget[]
}

export interface WriteResult {
  /** The file's new content, and its sha256 — the value the next `EditRequest` must supply. */
  newHash: string
  newText: string
  /** Path to the undo entry written for this change, if history is enabled. */
  historyFile?: string
}

export interface WriteOptions {
  /** Project root; edits outside it, or into denylisted directories, are refused. Default: `process.cwd()`. */
  projectRoot?: string
  /**
   * Skip the "file must be tracked by git" check. The CLI sets this for `--fix` on a file it just
   * read in the same process, since a stale-hash race isn't possible there; the overlay never
   * does, since a dev server editing an untracked scratch file has no way to undo cleanly.
   */
  allowUntracked?: boolean
  /** Where undo entries are written. Default: `<projectRoot>/.voxfold/history`. */
  historyDir?: string
  /** Keep at most this many undo entries. Default 100. */
  maxHistoryEntries?: number
}
