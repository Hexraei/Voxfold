/**
 * Step 1 of the protocol: is this even a file we're allowed to touch, before anything else runs.
 */

import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import { WriteError } from '../errors.ts'

const MAX_FILE_BYTES = 2 * 1024 * 1024

/** Directories a write must never land in, even if the project root somehow contains them. */
const DENYLISTED_SEGMENTS = new Set(['node_modules', '.git'])

export function assertPathAllowed(file: string, projectRoot: string): void {
  if (!isAbsolute(file)) {
    throw new WriteError('PathOutsideProject', `${file}: writer requires an absolute path`)
  }

  let real: string
  try {
    real = realpathSync(file)
  } catch {
    throw new WriteError('PathOutsideProject', `${file}: does not exist`)
  }
  const realRoot = realpathSync(projectRoot)

  const rel = relative(realRoot, real)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new WriteError(
      'PathOutsideProject',
      `${file}: resolves outside the project root (${realRoot}), refusing to write`,
    )
  }

  const segments = rel.split(sep)
  if (segments.some((segment) => DENYLISTED_SEGMENTS.has(segment))) {
    throw new WriteError('PathInDenylistedDir', `${file}: inside a denylisted directory`)
  }

  const size = statSync(real).size
  if (size > MAX_FILE_BYTES) {
    throw new WriteError(
      'FileTooLarge',
      `${file}: ${size} bytes exceeds the ${MAX_FILE_BYTES}-byte limit`,
    )
  }
}
