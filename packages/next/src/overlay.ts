/**
 * `@voxfold/next/overlay` — the browser bootstrap, the Next.js counterpart to
 * `@voxfold/vite`'s `client.ts`. Two ways to load it:
 *
 *  1. AUTOMATIC (preferred): `withVoxfold` appends this module's specifier to
 *     `instrumentationClientInject`, so Next imports it for its side effect ahead of the user's
 *     own `instrumentation-client.ts` and ahead of React hydration — see `index.ts`'s module doc
 *     for why this hook (Next 16.3.0+) is the primary path.
 *  2. FALLBACK: the `<VoxfoldOverlay/>` client component (`component.tsx`) calls the same
 *     `bootstrap()` from a `useEffect`, for apps on a Next version before `instrumentationClientInject`
 *     existed.
 *
 * UNLIKE `@voxfold/vite`'s `client.ts` (served as raw source through a Vite virtual module, because
 * Vite-only `?worker`/`?inline` import syntax needs Vite's own resolver), this file is a NORMAL
 * TypeScript module, pre-built by this package's own tsdown config into `dist/overlay.mjs` — Next's
 * webpack/Turbopack client compilation bundles it like any other import. No virtual-module trick is
 * needed for JS: `@voxfold/overlay`'s main entry is a plain ESM import into this module, bundled
 * normally by Next's client compilation like any other dependency.
 *
 * The worker and the CSS are a different story, and share the SAME workaround, for the same root
 * cause: both need their content as a browser-loadable resource, but `@voxfold/overlay` is
 * installed only under `@voxfold/next`'s own `node_modules` (pnpm's strict linking — the consuming
 * app never gets a direct copy), and this package's own tsdown build (Node/rolldown) is a different
 * toolchain from whatever bundles the CONSUMING app, so there is no reliable bundler-level import
 * syntax (Vite's `?worker`/`?inline`, webpack's `new URL(...)` asset resolution) that both build
 * steps would honor consistently. Instead the SIDECAR itself — a plain Node process with normal
 * filesystem access to its own `node_modules`, already serving the edit API — serves both files
 * directly: `GET /style.css` (the overlay's stylesheet text, for `mountOverlay`, matching what
 * `@voxfold/vite`'s `?inline` import provides) and `GET /worker.js` (the lint worker's compiled JS,
 * loaded into a `Worker` via a `Blob` URL rather than `new Worker(new URL(...))` — sidestepping the
 * bare-specifier-in-new-URL question entirely, since a Blob URL needs no module resolution from
 * the bundler at all). Both fetched over the same same-origin rewrite already used for the token
 * and the edit API (see `sidecar.ts` and `index.ts`'s `rewrites()`).
 *
 * TRANSPORT: `ApiClient`'s `basePath` points at `/api/__voxfold` — the same-origin path
 * `withVoxfold`'s `rewrites()` proxies to the sidecar (see `index.ts`). This is deliberately NOT a
 * cross-origin fetch straight to `127.0.0.1:<port>`: the port is chosen at sidecar startup, after
 * this client bundle has already been compiled, so there is no build-time value to bake in the way
 * `@voxfold/vite`'s inline `window.__VOXFOLD__` script can (Vite's dev server and the edit-server
 * middleware share one origin/port by construction; Next's sidecar deliberately does not). Routing
 * through Next's own dev server sidesteps needing the port in the browser at all.
 */

import { ApiClient, App, LintWorkerClient, mountOverlay } from '@voxfold/overlay'
import { h, render } from 'preact'

const SIDECAR_BASE_PATH = '/api/__voxfold'

export function bootstrap(): void {
  if (typeof window === 'undefined') return // Never runs on the server; guard anyway for safety.
  if (process.env.NODE_ENV === 'production') return // Belt-and-suspenders: see index.ts's gating.
  // Safe to call more than once (e.g. a project that mistakenly has BOTH
  // instrumentationClientInject and <VoxfoldOverlay/> wired up): mountOverlay() itself tears down
  // any existing #voxfold-overlay-root before creating a new one (the same HMR-safety it already
  // needs), so a duplicate bootstrap just re-mounts, it doesn't double-render.
  void run()
}

async function run(): Promise<void> {
  // The session token is generated inside the sidecar process at startup (see lockfile.ts /
  // sidecar.ts) and this bundle is compiled before that — so, like the CSS and worker content
  // below, it can only be learned at runtime, via GET /token over the same same-origin rewrite.
  const token = await fetchText(`${SIDECAR_BASE_PATH}/token`)
  const styles = await fetchText(`${SIDECAR_BASE_PATH}/style.css`)
  const workerSource = await fetchText(`${SIDECAR_BASE_PATH}/worker.js`)
  if (token === undefined || styles === undefined || workerSource === undefined) {
    console.warn('[voxfold] could not reach the sidecar edit server — overlay not mounting.')
    return
  }

  const mount = mountOverlay(styles)

  // A Blob URL needs no bundler-level module resolution at all (see module doc) — the worker's
  // compiled JS, fetched as text above, is wrapped in a same-origin `Worker` this way instead.
  const workerBlobUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
  const worker = new LintWorkerClient(new Worker(workerBlobUrl, { type: 'module' }))

  const api = new ApiClient({ token, basePath: SIDECAR_BASE_PATH })

  render(h(App, { worker, api, layer: mount.layer, overlayRoot: mount.root }), mount.layer)
}

async function fetchText(path: string): Promise<string | undefined> {
  try {
    const response = await fetch(path)
    if (!response.ok) return undefined
    return await response.text()
  } catch {
    return undefined
  }
}

bootstrap()
