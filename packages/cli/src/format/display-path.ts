/**
 * A `FileResult.file` is either a filesystem path or a URL (when linting `voxfold https://...`).
 * `node:path`'s `relative()` treats a URL as a path and mangles it — `http://host/x` collapses
 * to `http:/host/x`, silently losing a slash. URLs are displayed as-is; only real paths are
 * made relative to cwd for readability.
 */

import { relative } from 'node:path'

const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i

export function displayPath(file: string, cwd: string): string {
  if (URL_PATTERN.test(file)) return file
  return relative(cwd, file) || file
}
