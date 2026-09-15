/**
 * The sidecar edit server: a standalone `node:http` server wrapping `@voxfold/edit-server`'s
 * transport-agnostic handlers, the same way `@voxfold/vite`'s `configureServer` middleware does —
 * just over a real HTTP listener instead of a dev-server middleware hook, because Next.js's dev
 * server (webpack or Turbopack, not Vite) has no `configureServer` equivalent this package can
 * hook into directly (see the package's module doc for the full reasoning).
 *
 * Runs as its own `http.Server` on `127.0.0.1:<random port>`, started once per `next dev` process
 * from `withVoxfold` and guarded against duplicate starts across Next's repeated config
 * evaluation by the lockfile in `lockfile.ts`.
 *
 * Adds routes beyond what `@voxfold/vite`'s middleware exposes:
 *   - `POST /register`: the webpack/Turbopack stamp loader (`loader.ts`) calls this to report each
 *     file's stamp entries into this process's `StampRegistry` — necessary because the loader may
 *     run in a separate worker thread/process from this one (see `loader.ts`'s module doc), so
 *     there is no shared memory to close over the way the Vite plugin's `transform` hook and
 *     `configureServer` middleware do.
 *   - `GET /token`, `GET /style.css`, `GET /worker.js`: the browser bootstrap (`overlay.ts`) fetches
 *     these at runtime because none of them are knowable/embeddable at THAT file's own build time
 *     (the token is generated when this process starts, after `overlay.ts` is already compiled; the
 *     CSS/worker content workaround is explained in `overlay.ts`'s module doc). Serving them from
 *     here — a plain Node process with normal filesystem access to its own `node_modules` — is the
 *     simplest thing that actually works across both webpack and Turbopack without depending on
 *     either bundler's asset-resolution quirks.
 */

import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  apply,
  type EditServerContext,
  EditServerError,
  lintFile,
  openInEditor,
  plan,
  resolve,
  StampRegistry,
  suppress,
  undo,
} from '@voxfold/edit-server'
import { jsxAdapter } from '@voxfold/lang-jsx'
import { recommended } from '@voxfold/rules-recommended'

const SUPPRESSIONS_FILENAME = 'voxfold-suppressions.json'

function isLoopback(address: string | undefined): boolean {
  if (!address) return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw.length > 0 ? JSON.parse(raw) : {}
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

function sendText(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.statusCode = status
  res.setHeader('content-type', contentType)
  res.end(body)
}

// Read once per process (this content is static for the lifetime of a sidecar — @voxfold/overlay
// itself isn't hot-reloaded) rather than on every request.
let cachedStyleCss: string | undefined
let cachedWorkerJs: string | undefined

// `require.resolve` via `createRequire`, NOT `import.meta.resolve`: Next.js loads `next.config.ts`
// (and this package, transitively) through its own SWC-based require hook
// (`next/dist/build/next-config-ts/transpile-config.js`, confirmed by inspecting Next 16.3.5's own
// source) — under that loader, `import.meta.resolve` was observed in manual end-to-end testing to
// fail with a bare "Invalid URL" (from `fileURLToPath` receiving something other than a real
// resolved URL) even though `import.meta.url` itself resolves correctly. `require.resolve` is the
// long-standing, universally-supported CJS resolution primitive Next's own require-hook-based
// config loading is built around, and it worked correctly in the same manual test where
// `import.meta.resolve` did not.
const require = createRequire(import.meta.url)

function readOverlayAsset(specifier: string): string {
  return readFileSync(require.resolve(specifier), 'utf8')
}

// Not `@voxfold/overlay/worker` directly: that build leaves `@voxfold/core`/
// `@voxfold/rules-recommended` as external bare imports (fine for a real bundler, unusable from a
// Blob-URL worker — see worker-entry.ts's module doc). `./worker-bundle.mjs`, a sibling of this
// compiled file, inlines them.
function workerBundlePath(): string {
  return fileURLToPath(new URL('./worker-bundle.mjs', import.meta.url))
}

export interface SidecarOptions {
  projectRoot: string
  token: string
  /**
   * The dev origin(s) allowed to send credentials/token-bearing requests, when known. Next's own
   * dev port can change between runs (auto-retry when the configured port is busy) and isn't
   * knowable at `next.config.js` evaluation time — see the module doc in `index.ts` for the
   * CORS tradeoff this drives. `undefined` means "not known yet," handled as loopback-gated but
   * origin-permissive (see `corsOriginFor` below).
   */
  devOrigins?: string[]
  allowRemoteEdits?: boolean
}

export interface Sidecar {
  port: number
  token: string
  close(): Promise<void>
}

function corsHeaders(req: IncomingMessage, res: ServerResponse, options: SidecarOptions): void {
  const origin = req.headers.origin
  // The PRIMARY browser transport is same-origin: `withVoxfold`'s `rewrites()` proxies
  // `/api/__voxfold/*` through Next's own dev server to this sidecar, so the browser never sees
  // this origin directly and CORS headers don't gate that path at all (same-origin requests carry
  // no preflight). These headers exist for the documented FALLBACK case — a tool, script, or
  // older `@voxfold/next` overlay build that talks to the sidecar's `127.0.0.1:<port>` directly.
  // Exact-match against known dev origins when given; otherwise reflect the request's own Origin.
  // This is the honest tradeoff: Next's dev port is not knowable at config-evaluation time in
  // every setup (custom server, `--port 0`, auto-retry on a busy port), so a hardcoded allowlist
  // would break those setups outright for a path that's already secondary. The real security
  // boundary is NOT origin-matching — it's `isLoopback` (below) plus the per-session `token`
  // (random per process, required on every mutating request): a request from a non-loopback
  // address is rejected before the origin check even matters, and a same-machine request without
  // the token still gets 403. CORS here only relaxes which same-origin-policy browsers enforce for
  // the loopback fallback case; it is not the auth boundary.
  if (options.devOrigins && options.devOrigins.length > 0) {
    if (origin && options.devOrigins.includes(origin))
      res.setHeader('access-control-allow-origin', origin)
  } else if (origin) {
    res.setHeader('access-control-allow-origin', origin)
  }
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type, x-voxfold-token')
  res.setHeader('vary', 'origin')
}

export function startSidecar(options: SidecarOptions): Promise<Sidecar> {
  const registry = new StampRegistry([jsxAdapter])
  const suppressionsPath = join(options.projectRoot, SUPPRESSIONS_FILENAME)
  const ctx: EditServerContext = {
    registry,
    projectRoot: options.projectRoot,
    ruleset: recommended,
    suppressionsPath,
    allowedRoot: options.projectRoot,
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    corsHeaders(req, res, options)

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    if (!options.allowRemoteEdits && !isLoopback(req.socket.remoteAddress)) {
      sendJson(res, 403, { code: 'RemoteEditsDisabled', message: 'edit server is loopback-only' })
      return
    }

    const route = req.url?.split('?')[0] ?? ''

    // GET routes: static/near-static resources the browser bootstrap needs before it can even
    // make its first authenticated POST (see module doc). No token check — the token itself is
    // one of these routes, so requiring it here would be circular. The trust boundary for all
    // three is the same loopback-or-same-origin-rewrite gate everything else on this server
    // uses, which is deliberately weaker than the POST routes' token check because none of these
    // three routes can mutate anything.
    if (req.method === 'GET') {
      if (route === '/token') {
        sendText(res, 200, 'text/plain', options.token)
        return
      }
      if (route === '/style.css') {
        cachedStyleCss ??= readOverlayAsset('@voxfold/overlay/style.css')
        sendText(res, 200, 'text/css', cachedStyleCss)
        return
      }
      if (route === '/worker.js') {
        cachedWorkerJs ??= readFileSync(workerBundlePath(), 'utf8')
        sendText(res, 200, 'text/javascript', cachedWorkerJs)
        return
      }
      sendJson(res, 404, { code: 'NotFound', message: 'not found' })
      return
    }

    if (req.method !== 'POST') {
      sendJson(res, 404, { code: 'NotFound', message: 'not found' })
      return
    }

    // /register is called by the stamp loader itself (a build-time process), not the browser —
    // no session token check, since the loader has no way to learn the token except by reading
    // the same lockfile this process wrote, at which point it already has local filesystem
    // access equal to this process's own trust level. Every OTHER route is browser-facing and
    // stays token-gated below.
    if (route === '/register') {
      try {
        const body = (await readJsonBody(req)) as {
          relativePath: string
          format: string
          fileHash: string
          entries: Parameters<StampRegistry['update']>[3]
        }
        registry.update(body.relativePath, body.format, body.fileHash, body.entries)
        sendJson(res, 200, {})
      } catch (error) {
        sendJson(res, 500, {
          code: 'InternalError',
          message: error instanceof Error ? error.message : String(error),
        })
      }
      return
    }

    if (req.headers['x-voxfold-token'] !== options.token) {
      sendJson(res, 403, { code: 'InvalidToken', message: 'missing or invalid session token' })
      return
    }

    try {
      const body = (await readJsonBody(req)) as Record<string, unknown>
      switch (route) {
        case '/resolve':
          sendJson(res, 200, resolve(ctx, body as never))
          return
        case '/plan':
          sendJson(res, 200, await plan(ctx, body as never))
          return
        case '/apply':
          sendJson(res, 200, await apply(ctx, body as never))
          return
        case '/undo':
          await undo(ctx, body as never)
          sendJson(res, 200, {})
          return
        case '/suppress':
          await suppress(ctx, body as never)
          sendJson(res, 200, {})
          return
        case '/lint':
          sendJson(res, 200, await lintFile(ctx, body as never))
          return
        case '/open-in-editor':
          await openInEditor(ctx, body as never)
          sendJson(res, 200, {})
          return
        default:
          sendJson(res, 404, { code: 'NotFound', message: `no route ${route}` })
      }
    } catch (error) {
      if (error instanceof EditServerError) {
        sendJson(res, error.status, { code: error.code, message: error.message })
        return
      }
      sendJson(res, 500, {
        code: 'InternalError',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      // Belt-and-suspenders: every route above has its own try/catch, but a synchronous throw
      // OUTSIDE those (e.g. corsHeaders itself, or a bug in a future route added without one)
      // would otherwise reject this promise into `void` and leave the response hanging forever
      // with no bytes ever written — confirmed as a real failure mode in manual testing (a
      // readOverlayAsset failure hung curl/fetch indefinitely instead of erroring, before this
      // catch existed).
      if (!res.headersSent) {
        sendJson(res, 500, {
          code: 'InternalError',
          message: error instanceof Error ? error.message : String(error),
        })
      } else {
        res.end()
      }
    })
  })

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    // Port 0 asks the OS for any free ephemeral port — the same "random port" every other
    // sidecar-style dev tool (e.g. React DevTools' backend, webpack-dev-server's HMR fallback)
    // uses when it can't assume a fixed port is free.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('sidecar: could not determine listening port'))
        return
      }
      resolvePromise({
        port: address.port,
        token: options.token,
        close: () => new Promise<void>((res) => server.close(() => res())),
      })
    })
  })
}
