/**
 * The overlay's actual browser entry point for Astro's dev server. Served as SOURCE, not
 * pre-built, and injected identically to `@voxfold/vite`'s own `client.ts` (this file is a
 * near-verbatim copy — see that file's doc comment for the full rationale, repeated only where
 * Astro's own wiring differs below): `index.ts` exposes this file as the virtual module
 * `virtual:voxfold/client.ts` (via `resolveId`/`load` on the Vite plugin `updateConfig` adds), and
 * Astro's `injectScript('page', 'import "virtual:voxfold/client.ts"')` (see `index.ts`) makes that
 * import part of every page's own JS bundle — Astro's dev server IS Vite underneath (confirmed via
 * `astro:server:setup`'s `server: ViteDevServer`, the exact same type from the `vite` package), so
 * this virtual-module trick works completely unchanged from the Vite integration.
 *
 * `@voxfold/overlay` and `preact` below are bare package imports needing the same absolute-path
 * rewrite `@voxfold/vite`'s `index.ts` does (see that file's `resolveClientImports`) — reused
 * as-is here.
 *
 * DELIBERATELY ZERO TypeScript-only syntax in this file — see `@voxfold/vite`'s `client.ts` for
 * why (it's served to the browser as literal, unprocessed text).
 */

import { ApiClient, App, LintWorkerClient, mountOverlay } from '@voxfold/overlay'
// @ts-expect-error -- Vite's `?inline` query import returns the file's contents as a string.
import overlayStyles from '@voxfold/overlay/style.css?inline'
// @ts-expect-error -- Vite's `?worker` query import; no ambient type for it outside a Vite app.
import OverlayWorker from '@voxfold/overlay/worker?worker'
import { h, render } from 'preact'

function bootstrap() {
  // @ts-expect-error -- __VOXFOLD__ is set by index.ts's injectScript('page', ...) config script.
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

  render(h(App, { worker, api, layer: mount.layer, overlayRoot: mount.root }), mount.layer)
}

bootstrap()
