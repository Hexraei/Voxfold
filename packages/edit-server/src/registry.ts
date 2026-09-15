/**
 * The stamp registry: every `StampEntry` a transform has produced, keyed by id, updated on every
 * re-transform (so on every HMR). This is the only state the edit server keeps in memory — the
 * source of truth is always the file on disk, checked fresh by the writer on every apply.
 */

import type { LanguageAdapter, NodeRef, StampEntry } from '@voxfold/core'

interface FileRecord {
  relativePath: string
  format: string
  /** The file's content hash at the moment it was last transformed, for a fast staleness check. */
  fileHash: string
  entries: Map<string, StampEntry>
}

export class StampRegistry {
  private readonly files = new Map<string, FileRecord>()
  private readonly adaptersByFormat: Map<string, LanguageAdapter>

  constructor(adapters: readonly LanguageAdapter[]) {
    this.adaptersByFormat = new Map(adapters.map((adapter) => [adapter.id, adapter]))
  }

  adapterFor(format: string): LanguageAdapter | undefined {
    return this.adaptersByFormat.get(format)
  }

  /** Replace every entry for `relativePath` with a fresh transform's output. */
  update(
    relativePath: string,
    format: string,
    fileHash: string,
    entries: readonly StampEntry[],
  ): void {
    const map = new Map(entries.map((entry) => [entry.id, entry]))
    this.files.set(relativePath, { relativePath, format, fileHash, entries: map })
  }

  remove(relativePath: string): void {
    this.files.delete(relativePath)
  }

  get(id: string): StampEntry | undefined {
    for (const record of this.files.values()) {
      const entry = record.entries.get(id)
      if (entry) return entry
    }
    return undefined
  }

  fileHashFor(relativePath: string): string | undefined {
    return this.files.get(relativePath)?.fileHash
  }

  formatFor(relativePath: string): string | undefined {
    return this.files.get(relativePath)?.format
  }

  /** Every relative path currently known, for the "only files we stamped may be touched" guard. */
  knownPaths(): ReadonlySet<string> {
    return new Set(this.files.keys())
  }
}

/** A resolved editable segment, ready for the overlay to act on — the `resolve` handler's output. */
export interface ResolvedRef {
  ref: NodeRef
  editable: boolean
  relativePath: string
  lockReason?: string
}
