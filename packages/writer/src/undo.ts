/**
 * Undo: restore a file from the history entry the protocol wrote just before its last edit.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WriteError } from './errors.ts'

interface HistoryEntry {
  file: string
  timestamp: string
  content: string
}

export function readHistoryEntry(historyFile: string): HistoryEntry {
  return JSON.parse(readFileSync(historyFile, 'utf8')) as HistoryEntry
}

/** Restore `file`'s content from its most recent history entry in `historyDir`. */
export function undoLast(file: string, historyDir: string): void {
  const entries = readdirSync(historyDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .reverse()

  for (const name of entries) {
    const entry = readHistoryEntry(join(historyDir, name))
    if (entry.file === file) {
      writeFileSync(file, entry.content, 'utf8')
      return
    }
  }
  throw new WriteError('NoEdits', `${file}: no history entry found in ${historyDir}`)
}
