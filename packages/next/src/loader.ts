/**
 * Webpack/Turbopack stamp loader: injects `data-vf` into JSX/TSX source the same way
 * `@voxfold/vite`'s `transform` hook does, reusing `@voxfold/lang-jsx`'s `stamp()` directly.
 *
 * UNLIKE Vite (a single process, one in-memory `StampRegistry` the plugin's `transform` hook and
 * `configureServer` middleware both close over directly), a webpack loader runs inside webpack's
 * own loader pipeline — under `experiments.webpackBuildWorker` or with `next dev --turbopack`,
 * that pipeline runs in a worker thread/process genuinely separate from the process that
 * evaluates `next.config.js` and starts this package's sidecar HTTP server (see `sidecar.ts`).
 * There is no shared memory to close over. Instead, this loader POSTs each file's stamp entries
 * to the sidecar over HTTP (`POST /register`) — the sidecar owns the one real `StampRegistry`,
 * and the loader is a pure reporter. The registration call is fire-and-forget
 * from webpack's perspective (loaders must return synchronously-ish; `this.async()` + a
 * non-blocking fetch means the loader doesn't stall the build waiting on the registration round
 * trip) but IS awaited internally so a slow sidecar can't silently drop entries under load.
 *
 * Turbopack loaders use the exact same webpack-loader-shaped default export (Turbopack's `rules`
 * config wires plain webpack-loader-context-compatible functions — verified against Next 16's
 * `TurbopackLoaderItem` type, which accepts a loader specifier string identical to webpack's
 * `module.rules[].use` shape) so ONE loader file serves both bundlers; no Turbopack-specific
 * fork needed.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { jsxAdapter } from '@voxfold/lang-jsx'

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export interface LoaderOptions {
  /** Absolute project root, for computing each file's relative path and locating the lockfile. */
  projectRoot: string
}

/**
 * The loader is only ever given `projectRoot` at config-construction time (NOT a baked-in
 * `sidecarUrl`/`token`): `withVoxfold` builds `module.rules`/`turbopack.rules` synchronously,
 * before the async sidecar start (`ensureSidecar` in `index.ts`) can have written its lockfile on
 * a project's very first `next dev` run — baking in a port read at that moment would race and
 * could freeze in an empty/stale value for the whole dev session. A loader invocation, by
 * contrast, happens well after `next.config.js` finishes evaluating and Next's dev server has
 * actually started serving — by then the sidecar (started fire-and-forget from `withVoxfold`) has
 * had ample time to write `.voxfold/server.json`. Reading it fresh on every invocation is a few
 * bytes of sync file I/O per compiled file, negligible next to the JSX parse this loader already
 * does, and it means a sidecar restart (a new port after a crash) is picked up automatically on
 * the next file edit without needing `next.config.js` to be re-evaluated at all.
 */
function readLock(projectRoot: string): { port: number; token: string } | undefined {
  try {
    const raw = readFileSync(join(projectRoot, '.voxfold', 'server.json'), 'utf8')
    const data = JSON.parse(raw)
    if (typeof data.port === 'number' && typeof data.token === 'string') return data
    return undefined
  } catch {
    return undefined
  }
}

// Registration is fire-and-forget from webpack's scheduling perspective (this loader does not
// block the build on it succeeding — a sidecar that's still starting up, or briefly unreachable
// during a config re-eval, should never fail an otherwise-good compile) but real failures are
// logged once so a genuinely broken sidecar is discoverable, not silently swallowed forever.
let warnedOnce = false

async function registerStamp(
  lock: { port: number; token: string },
  relativePath: string,
  fileHash: string,
  entries: unknown,
): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${lock.port}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-voxfold-token': lock.token },
      body: JSON.stringify({ relativePath, format: 'jsx', fileHash, entries }),
    })
  } catch (error) {
    if (!warnedOnce) {
      warnedOnce = true
      console.warn(
        `[voxfold] could not reach the sidecar edit server on port ${lock.port} — ` +
          `stamped elements won't be editable this session. (${error instanceof Error ? error.message : String(error)})`,
      )
    }
  }
}

/**
 * Default export, webpack-loader-shaped: `(source) => string`. Synchronous — `stamp()` itself is
 * sync (Babel parse + magic-string splice, no I/O) — with the sidecar POST kicked off
 * fire-and-forget via `this.async()`'s callback NOT being required: the loader returns the
 * stamped code immediately and the registration happens concurrently, since the overlay can only
 * ever ask to resolve a stamp id after the page has loaded, by which point every loader
 * invocation from that compile has long since fired its POST.
 */
export default function voxfoldStampLoader(this: unknown, source: string): string {
  // webpack's loader `this` context has no shared published type this package can import
  // without depending on webpack itself.
  // biome-ignore lint/suspicious/noExplicitAny: see above.
  const context = this as any
  const options: LoaderOptions = context.getOptions ? context.getOptions() : {}
  if (!options.projectRoot) return source // Misconfigured — pass through inert.

  const resourcePath: string = context.resourcePath ?? context.resource ?? ''
  if (resourcePath.includes('node_modules')) return source

  const relativePath = relative(options.projectRoot, resourcePath)

  try {
    const result = jsxAdapter.stamp!(source, { uri: resourcePath, relativePath })
    // Fire-and-forget from the loader's own return value, but the async body still runs to
    // completion (Node keeps the process alive for a pending fetch) — see function doc. The
    // lockfile read (see readLock's doc) happens fresh here, at invocation time, not baked into
    // `options` at config-construction time.
    const lock = readLock(options.projectRoot)
    if (lock) void registerStamp(lock, relativePath, sha256(source), result.entries)
    return result.code
  } catch {
    // Same fallback every other adapter integration uses: a file that fails to stamp is passed
    // through unstamped rather than failing the whole compile.
    return source
  }
}
