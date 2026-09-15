/**
 * @voxfold/next — the Next.js integration: a webpack + Turbopack stamp loader, a sidecar
 * `node:http` edit server, and overlay bootstrap injection via `instrumentationClientInject`.
 *
 * ARCHITECTURE, and why it differs from `@voxfold/vite`/`@voxfold/astro`:
 *
 * Both earlier integrations hook a single dev-server middleware surface (`configureServer`) that
 * runs in the SAME process as the plugin's own `transform` hook, so a plain in-memory
 * `StampRegistry` closure ties everything together. Next.js has no such hook: its dev server is
 * webpack- or Turbopack-based, not Vite, and neither bundler exposes a "run this middleware on my
 * dev server" extension point a `next.config.js` plugin can reach into (`next.config.js`'s own
 * `NextJsWebpackConfig` type — verified in `node_modules/next/dist/server/config-shared.d.ts` —
 * only lets a plugin mutate the webpack `Configuration` object itself, nothing about the HTTP
 * server Next builds around it). So this package runs its OWN standalone `node:http` server (the
 * "sidecar," `sidecar.ts`) alongside Next's dev server, on a random loopback port, and the stamp
 * loader (`loader.ts`) — which may run in a separate webpack/Turbopack worker process — reports
 * its stamp entries to that sidecar over HTTP instead of sharing memory with it. The loader and
 * the overlay bootstrap (`overlay.ts`) both learn the sidecar's actual port by reading
 * `.voxfold/server.json` (`lockfile.ts`) fresh — at loader-invocation time and at browser
 * bootstrap time respectively — rather than from any value baked in when `next.config.js` itself
 * was evaluated, because the sidecar starts asynchronously and its port is not yet known at the
 * moment this file's `webpack()`/`turbopack` config is constructed (see `ensureSidecar` below).
 *
 * VERIFIED AGAINST: Next.js 16.3.5 (the current `latest` dist-tag as of this build; `npm view next
 * dist-tags` also lists an `rc`/`beta`/`canary` line for 16.4, but 16.3.5 is what a real project
 * would install today, and the build plan's own "15 webpack + 16 Turbopack" framing is honored by
 * this version, which ships both). Every config shape below (webpack loader rules,
 * `turbopack.rules`, `instrumentationClientInject`) was read directly out of this version's
 * `.d.ts` files and cross-checked against its shipped docs under `next/dist/docs/`, not assumed
 * from general knowledge of older Next versions — Turbopack's `rules` config in particular has
 * changed shape across Next releases and stale knowledge here would silently produce a config
 * Next accepts but never actually applies.
 *
 * STAMP LOADER WIRING:
 *   - webpack: `config.module.rules.push({ test: /\.[jt]sx$/, exclude: /node_modules/, use: [{
 *     loader: <path to loader.js>, options: {...} }] })` inside the `webpack()` config function,
 *     gated on `context.dev` (the `WebpackConfigContext.dev` boolean Next's own type hands the
 *     function — `dev: true` only for `next dev`, confirmed never true for `next build`).
 *   - Turbopack: `turbopack.rules['*.{jsx,tsx}'] = { loaders: [{ loader: ..., options: {...} }] }`
 *     — `TurbopackRuleConfigItem.loaders` accepts the same `{loader, options}` shape as a webpack
 *     `use` entry (verified: `TurbopackLoaderItem` is `string | {loader: string; options?:
 *     TurbopackLoaderOptions}`, structurally identical to webpack's). Turbopack has no
 *     `dev`-vs-`build` distinction in `turbopack.rules` itself (it's one static config key, not a
 *     function like `webpack()`), so `withVoxfold` only ever WRITES to `turbopack.rules` when
 *     `isDevInvocation()` (below) already says this evaluation is for `next dev`.
 *
 * OVERLAY INJECTION: `instrumentationClientInject` (Next 16.3.0+, verified in
 * `config-shared.d.ts` and `next/dist/docs/.../instrumentationClientInject.md`) is Next's own
 * documented mechanism for a `next.config.js` PLUGIN — not application code — to inject a
 * client-side module ahead of the user's `instrumentation-client.ts`, without requiring the user
 * to hand-author that file at all; the doc's own worked example is a `withMyInstrumentation`
 * wrapper structurally identical to `withVoxfold`. `withVoxfold` appends `@voxfold/next/overlay`
 * to that array as the PRIMARY injection path. `<VoxfoldOverlay/>` (`component.tsx`) is the
 * documented fallback for apps on Next 15.x or early 16.x, before `instrumentationClientInject`
 * existed (still within this package's `next >=15.0.0` peer range).
 *
 * DEV-ONLY GATING: every side effect below (webpack rule, turbopack rule, sidecar start, injected
 * overlay import) is behind `isDevInvocation()` — `next build`/`next start` never see any of it,
 * matching `@voxfold/vite`'s `apply: 'serve'` guarantee that a production bundle never ships a
 * `data-vf` attribute or a live write endpoint.
 */

import type { NextConfig } from 'next'
import { newToken, readLiveLock, waitForLiveLock, writeLock } from './lockfile.ts'
import { startSidecar } from './sidecar.ts'

// `WebpackConfigContext`/`NextJsWebpackConfig` aren't re-exported from the public `next` entry
// point (only `NextConfig` is, per `next/dist/types.d.ts`) — derived structurally from
// `NextConfig['webpack']` instead of hand-copying the shape, so this stays correct if that
// context type ever grows a field between Next versions.
type WebpackFn = NonNullable<NextConfig['webpack']>
type WebpackConfigContext = Parameters<WebpackFn>[1]

export interface VoxfoldNextOptions {
  /** Allow non-loopback clients to reach the sidecar. Default false — dev-only, local-only. */
  allowRemoteEdits?: boolean
  /**
   * Known dev origin(s) for CORS (e.g. `http://localhost:3000`). Next's own dev port isn't
   * knowable at `next.config.js` evaluation time in every setup (see `sidecar.ts`'s
   * `corsHeaders` for the full tradeoff) — pass this when the port is fixed (e.g. via `-p` in a
   * script) to tighten CORS beyond the loopback-plus-token default.
   */
  devOrigins?: string[]
}

// `.mjs`, matching tsdown's actual emitted filename for this package's `loader` entry (see
// tsdown.config.ts) — mismatching this against the real built extension produced a real
// "Cannot find module .../loader.js" failure from Turbopack in manual testing, since webpack's
// loader resolution (and Turbopack's, which reuses the same require.resolve path per its own
// source) does no extension-guessing beyond what's actually on disk.
const LOADER_SPECIFIER = new URL('./loader.mjs', import.meta.url).pathname
const STAMP_TEST = /\.[jt]sx$/

/**
 * `next dev` sets `NODE_ENV=development` before `next.config.js` is ever imported (confirmed
 * against `next/dist/cli/next-dev.js`, which sets it ahead of the config loader) and `next
 * build`/`next start` always run with `production`. Checked here, in addition to
 * `WebpackConfigContext.dev` inside `webpack()`, because `turbopack.rules` and the sidecar start
 * need an answer before that context exists — the two checks agree in every normal invocation.
 */
function isDevInvocation(): boolean {
  return process.env.NODE_ENV !== 'production'
}

let sidecarStartPromise: Promise<void> | undefined

/**
 * Starts the sidecar at most once per process, reusing a live lockfile from another worker's
 * evaluation of the same config when one already exists (see `lockfile.ts`'s module doc for why
 * config evaluation happens more than once and why a naive "start on every call" would leak
 * servers and hand out inconsistent ports). Fire-and-forget from `withVoxfold`'s own perspective
 * — see the call site for why this can't be awaited inline.
 */
async function ensureSidecar(projectRoot: string, options: VoxfoldNextOptions): Promise<void> {
  if (sidecarStartPromise) return sidecarStartPromise

  sidecarStartPromise = (async () => {
    const existing = await readLiveLock(projectRoot)
    if (existing) return

    const token = newToken()
    const sidecar = await startSidecar({
      projectRoot,
      token,
      ...(options.devOrigins ? { devOrigins: options.devOrigins } : {}),
      ...(options.allowRemoteEdits !== undefined
        ? { allowRemoteEdits: options.allowRemoteEdits }
        : {}),
    })
    writeLock(projectRoot, { port: sidecar.port, pid: process.pid, token: sidecar.token })
  })()

  return sidecarStartPromise
}

export function withVoxfold(
  nextConfig: NextConfig = {},
  options: VoxfoldNextOptions = {},
): NextConfig {
  if (!isDevInvocation()) return nextConfig // Never touch a production build — see module doc.

  const projectRoot = process.cwd()

  // Next.js does not await `withVoxfold`'s return value — it must be a plain object, not a
  // Promise — so the sidecar start races Next's own config resolution and dev-server startup in
  // the background. This is safe: the loader (loader.ts) and the overlay bootstrap (overlay.ts)
  // both read the lockfile fresh at their own, much-later invocation times (a compiled file, a
  // loaded page) rather than depending on any value from this synchronous function call. A
  // startup failure is logged, not thrown, so it can't crash `next dev` itself via an unhandled
  // rejection.
  void ensureSidecar(projectRoot, options).catch((error) => {
    console.warn(
      `[voxfold] sidecar edit server failed to start — the overlay will not be able to save ` +
        `edits this session. (${error instanceof Error ? error.message : String(error)})`,
    )
  })

  const loaderOptions = { projectRoot }

  return {
    ...nextConfig,

    // instrumentationClientInject is Next's own array — append rather than replace, so this
    // composes with any other next.config.js plugin doing the same (e.g. withSentry), exactly the
    // pattern Next's own docs show for a plugin author (see module doc).
    instrumentationClientInject: [
      ...(nextConfig.instrumentationClientInject ?? []),
      '@voxfold/next/overlay',
    ],

    // The browser-facing transport: a same-origin rewrite, NOT a cross-origin fetch straight to
    // the sidecar. `rewrites()` is an async function Next calls once while resolving the dev
    // server's routing table, so it can `await` the sidecar's own lockfile becoming live —
    // eliminating the "port not known yet" race a baked-in `env` value would have (see module
    // doc) — and it makes every `/api/__voxfold/*` request the overlay's `ApiClient` sends
    // same-origin from the browser's point of view, so no CORS is needed for this path at all.
    // `/api/` prefix (not bare `/__voxfold/*`) avoids colliding with an app's own top-level
    // routes under the App Router, where any path segment could be a real route.
    async rewrites() {
      const upstream = typeof nextConfig.rewrites === 'function' ? await nextConfig.rewrites() : []
      const lock = await waitForLiveLock(projectRoot)
      const voxfoldRewrite = lock
        ? [{ source: '/api/__voxfold/:path*', destination: `http://127.0.0.1:${lock.port}/:path*` }]
        : []

      if (Array.isArray(upstream)) return [...upstream, ...voxfoldRewrite]
      return {
        ...upstream,
        afterFiles: [...(upstream.afterFiles ?? []), ...voxfoldRewrite],
      }
    },

    webpack(config: unknown, context: WebpackConfigContext) {
      const base =
        typeof nextConfig.webpack === 'function' ? nextConfig.webpack(config, context) : config

      // Only the client compilation ever renders JSX to DOM the overlay could attach to — the
      // server compilation stamps too (RSC output ends up as real DOM in the browser regardless
      // of which compilation produced it, see overlay.ts's RSC finding), so this does NOT gate on
      // `context.isServer`, only on `context.dev`.
      if (!context.dev) return base

      // webpack's own Configuration type isn't a dependency of this package (Next only ever
      // hands this function an opaque `any`).
      // biome-ignore lint/suspicious/noExplicitAny: see above.
      const webpackConfig = base as any
      webpackConfig.module ??= {}
      webpackConfig.module.rules ??= []
      webpackConfig.module.rules.push({
        test: STAMP_TEST,
        exclude: /node_modules/,
        use: [{ loader: LOADER_SPECIFIER, options: loaderOptions }],
      })
      return webpackConfig
    },

    turbopack: {
      ...nextConfig.turbopack,
      rules: {
        ...nextConfig.turbopack?.rules,
        '*.{jsx,tsx}': {
          loaders: [{ loader: LOADER_SPECIFIER, options: loaderOptions }],
        },
      },
    },
  }
}

export default withVoxfold
