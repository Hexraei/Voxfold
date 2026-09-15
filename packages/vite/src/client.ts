/**
 * The overlay's actual browser entry point for Vite. Served as SOURCE, not pre-built: `index.ts`
 * exposes this file as the virtual module `virtual:voxfold/client` (via `resolveId`/`load`), so
 * Vite's own dev server compiles it as part of the app's module graph — resolving the Vite-only
 * `?worker`/`?inline` imports below the way it would for any app source file. A `<script
 * type="module">` tag that `transformIndexHtml` injects into every page imports that virtual id.
 *
 * This is the one place that uses Vite-specific import syntax — `@voxfold/overlay` itself stays
 * framework-tooling-agnostic so a future Next.js integration isn't stuck with Vite-only syntax in
 * a shared package.
 *
 * `@voxfold/overlay` and `preact` below are bare package imports, which only resolve correctly
 * from a location where those packages are actually installed. In a strict-linking package
 * manager (pnpm), the CONSUMING app's own `node_modules` only contains `@voxfold/vite` itself
 * (its direct dependency) — `@voxfold/overlay` and `preact`, dependencies of `@voxfold/vite`, are
 * never linked into the app. Vite resolves a virtual module's imports as if from the app's own
 * root, so these bare specifiers would fail there. `index.ts`'s `load()` hook rewrites this
 * file's text, replacing each one with an absolute path resolved from `@voxfold/vite`'s own
 * install location (via `import.meta.resolve`), where these packages genuinely are — a plain
 * string substitution over the real source below.
 *
 * DELIBERATELY ZERO TypeScript-only syntax in this file (no `declare`, no type annotations, no
 * `as` assertions — see `client.d.ts` for the one ambient type this file needs for its own
 * typechecking). This file is served to the browser as literal, unprocessed text: Vite does not
 * run its usual TS-stripping transform against a synthetic virtual module id the way it would for
 * a real `.ts` file on disk, so anything TS-only here would reach the browser as a syntax error.
 */

import { ApiClient, App, LintWorkerClient, mountOverlay } from '@voxfold/overlay'
// @ts-expect-error -- Vite's `?inline` query import returns the file's contents as a string.
import overlayStyles from '@voxfold/overlay/style.css?inline'
// @ts-expect-error -- Vite's `?worker` query import; no ambient type for it outside a Vite app.
import OverlayWorker from '@voxfold/overlay/worker?worker'
import { h, render } from 'preact'

function bootstrap() {
  // A `declare global` augmentation in a companion `.d.ts` (the standard way to type this) does
  // not reach across files under this TypeScript 7 prerelease — reproduced in isolation, tracked
  // as a real limitation of the experimental compiler, not a mistake in the setup.
  // @ts-expect-error -- see above; __VOXFOLD__ is set by transformIndexHtml's inline script.
  const config = window.__VOXFOLD__
  if (!config) {
    console.warn('[voxfold] client bootstrap ran without window.__VOXFOLD__ — not mounting.')
    return
  }

  const mount = mountOverlay(overlayStyles)
  const worker = new LintWorkerClient(new OverlayWorker())
  const api = new ApiClient({
    token: config.token,
    ...(config.basePath ? { basePath: config.basePath } : {}),
  })

  // `h(App, props)`, not `App(props)`: calling a component function directly runs its body
  // (including hooks) outside Preact's render/diff cycle entirely, so `options.__r` never sets
  // the current component instance and every hook call crashes reading `undefined.__H` — this was
  // the real cause of "Cannot read properties of undefined (reading '__H')", not a duplicate-Preact
  // bundling issue (ruled out by checking the actual network requests: only one copy of each
  // preact file is ever fetched).
  render(h(App, { worker, api, layer: mount.layer, overlayRoot: mount.root }), mount.layer)
}

bootstrap()
