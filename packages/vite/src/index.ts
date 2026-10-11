/**
 * @voxfold/vite — the Vite integration: stamps JSX/TSX in dev, serves the edit server over
 * `/__voxfold/*`, and injects the browser overlay's bootstrap script.
 *
 * Dev-only by construction: the stamp transform only runs when `apply: 'serve'` is active (never
 * during a production build), and the whole plugin is a no-op outside `command === 'serve'`. A
 * `data-vf` attribute or a live edit-server endpoint in a production bundle would be a real
 * information leak (file paths) and a real attack surface (a write endpoint), so this is checked
 * at the plugin's own entry point, not left to a caller to remember to disable.
 *
 * The overlay's browser bootstrap (`client.ts`, next to this file) is exposed as a VIRTUAL
 * MODULE rather than pre-built by this package's own bundler: it uses Vite-only import syntax
 * (`?worker`, `?inline`) that only resolves correctly when Vite's own dev server compiles it as
 * part of an app's module graph — the standard pattern for a plugin that needs to inject
 * bundler-aware client code (the same approach vite-plugin-pwa and unplugin-icons use).
 */

import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { dirname, join, relative } from 'node:path'
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
import type { Connect, Plugin, ViteDevServer } from 'vite'
import { normalizePath } from 'vite'

export interface VoxfoldPluginOptions {
  /** Mount path for the edit server. Default '/__voxfold'. */
  basePath?: string
  /** Extra CSS selectors the overlay's DOM flattener should skip. */
  skipSelectors?: string[]
  /** Allow non-loopback clients to reach the edit server. Default false — dev-only, local-only. */
  allowRemoteEdits?: boolean
}

const DEFAULT_BASE_PATH = '/__voxfold'
const SUPPRESSIONS_FILENAME = 'voxfold-suppressions.json'
// `.ts` on the end is load-bearing, not cosmetic: Vite's esbuild-based transform decides whether
// to strip TypeScript-only syntax (this file's `declare global` block, its type annotations)
// based on the id's extension. Without one, the virtual module is served as plain JavaScript and
// `declare global { ... }` reaches the browser as a syntax error.
const VIRTUAL_CLIENT_ID = 'virtual:voxfold/client.ts'
const RESOLVED_VIRTUAL_CLIENT_ID = `\0${VIRTUAL_CLIENT_ID}`
// Vite's own URL convention for addressing a resolved id whose internal form starts with a null
// byte: the byte is encoded as this literal placeholder, never the raw `\0` character, in any URL
// path this plugin constructs (e.g. the <script src> below) — see `NULL_BYTE_PLACEHOLDER` in
// Vite's own source.
const VIRTUAL_CLIENT_URL = `/@id/__x00__${VIRTUAL_CLIENT_ID}`

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Every `preact` entry point this plugin or its dependencies (`@voxfold/overlay`'s own built
 * bundle) import — handled uniformly via `resolveId` below (not the text substitution
 * `resolveClientImports` does for `client.ts` specifically) so EVERY importer, not just
 * `client.ts`, resolves to the exact same Preact instance. Two different copies of Preact on one
 * page break hooks entirely (see the long comment at that `resolveId` check).
 */
const PREACT_SPECIFIERS = new Set([
  'preact',
  'preact/hooks',
  'preact/jsx-runtime',
  'preact/jsx-dev-runtime',
])

/**
 * `client.ts` also imports `@voxfold/overlay` bare specifiers (its main entry, `style.css?inline`,
 * `worker?worker`) that only resolve from a location where that package is actually installed —
 * which, under pnpm's strict linking, is `@voxfold/vite`'s own `node_modules`, NOT the consuming
 * app's (see the long comment at the top of `client.ts` for why). Rewrite each occurrence to an
 * absolute path resolved from HERE, so Vite never needs to resolve the bare specifier itself when
 * it compiles the virtual module. (`preact` itself is handled by `resolveId` instead, since it
 * also needs to cover `@voxfold/overlay`'s OWN imports, not just `client.ts`'s.)
 *
 * `@voxfold/overlay` is built with tsdown's `fixedExtension: true` specifically so its output is
 * `dist/index.mjs`/`dist/worker.mjs`, not `.js`: a consuming app's own `@vitejs/plugin-react` (or
 * Vue/Svelte equivalent) runs its Fast Refresh transform on any id matching `/\.[tj]sx?$/` outside
 * `node_modules` — which a `/@fs/`-served `dist/index.js` would match, since a workspace package
 * under `packages/` isn't inside `node_modules`, and a `?query` suffix does NOT defeat that regex
 * (plugin-react explicitly rewrites it to tolerate a trailing query string). That transform
 * injects `$RefreshSig$` calls that corrupt Preact's unrelated hook state ("Cannot read properties
 * of undefined (reading '__H')") — confirmed by inspecting the served bundle and finding
 * refresh-runtime calls spliced into Preact-based code no framework transform should touch. `.mjs`
 * never matches that regex at all, the same reason Preact's own build ships `.mjs` files.
 */
const CLIENT_BARE_SPECIFIERS = [
  '@voxfold/overlay/style.css',
  '@voxfold/overlay/worker',
  '@voxfold/overlay',
]

function resolveClientImports(source: string): string {
  let rewritten = source
  for (const specifier of CLIENT_BARE_SPECIFIERS) {
    // A browser refuses to fetch a literal `file://` URL from a page served over http(s) — Vite's
    // own convention for a real filesystem path is a plain absolute path, which it then serves
    // itself through `/@fs/...` URL rewriting. `import.meta.resolve` returns a `file://` URL, so
    // convert it before splicing it into source Vite will hand straight to the browser.
    const resolved = normalizePath(fileURLToPath(import.meta.resolve(specifier)))
    // Longest-specifier-first order (see CLIENT_BARE_SPECIFIERS) so '@voxfold/overlay/worker'
    // is replaced before the bare '@voxfold/overlay' pattern could match a prefix of it.
    rewritten = rewritten.split(`'${specifier}`).join(`'${resolved}`)
  }
  return rewritten
}

/**
 * `client.ts` ships as source (not pre-built — see this file's module doc), published at
 * `src/client.ts` alongside the compiled `dist/index.mjs` this code runs as (see `files` in
 * `package.json`). Read and rewritten lazily so a plugin instance that's created but never used
 * to configure a real dev server never touches the filesystem for it.
 */
let cachedClientSource: string | undefined
function readClientSource(): string {
  if (cachedClientSource === undefined) {
    const packageRoot = dirname(dirname(fileURLToPath(import.meta.url))) // dist/ → package root
    const raw = readFileSync(join(packageRoot, 'src', 'client.ts'), 'utf8')
    cachedClientSource = resolveClientImports(raw)
  }
  return cachedClientSource
}

function isLoopback(address: string | undefined): boolean {
  if (!address) return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

async function readJsonBody(req: Connect.IncomingMessage): Promise<unknown> {
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

export function voxfold(options: VoxfoldPluginOptions = {}): Plugin {
  const basePath = options.basePath ?? DEFAULT_BASE_PATH
  const token = randomBytes(16).toString('hex')
  const registry = new StampRegistry([jsxAdapter])
  let projectRoot = process.cwd()

  return {
    name: 'voxfold',
    apply: 'serve',
    // Must see raw JSX before @vitejs/plugin-react (or its Vue/Svelte/Astro equivalents) rewrites
    // it into framework-specific runtime calls — 'pre' runs this plugin's transform hook ahead of
    // normal-priority plugins regardless of where `voxfold()` sits in the user's `plugins` array,
    // per the build plan's own spec for the stamp transform.
    enforce: 'pre',

    configResolved(config) {
      projectRoot = config.root
    },

    resolveId(id) {
      if (id === VIRTUAL_CLIENT_ID) return RESOLVED_VIRTUAL_CLIENT_ID
      // Any importer's `preact`/`preact/hooks`/`preact/jsx-runtime` — not just client.ts's own —
      // must resolve to the SAME instance, or Preact's hooks break with "Cannot read properties
      // of undefined (reading '__H')": `@voxfold/overlay`'s own built bundle imports these same
      // bare specifiers too, and under pnpm's strict linking the consuming app has no `preact` of
      // its own for Vite to (mis)resolve them against, which without this would otherwise let two
      // DIFFERENT copies of Preact end up loaded into the same page.
      if (PREACT_SPECIFIERS.has(id)) return normalizePath(fileURLToPath(import.meta.resolve(id)))
      return null
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_CLIENT_ID) return readClientSource()
      return null
    },

    transform(code, id) {
      if (process.env.VITEST) return null // Never stamp inside this monorepo's own test runs.
      if (!/\.(jsx|tsx)$/.test(id)) return null
      if (id.includes('node_modules')) return null

      const relativePath = relative(projectRoot, id).split('\\').join('/')
      try {
        const result = jsxAdapter.stamp!(code, { uri: id, relativePath })
        registry.update(relativePath, 'jsx', sha256(code), result.entries)
        // `StampResult.map` is `unknown` on the core side (adapters must stay build-tool
        // agnostic), but `stamp()`'s real implementation (magic-string's `generateMap()`) always
        // produces a valid source map object — Vite's own `TransformResult['map']` type is what
        // actually constrains the shape here, so trust the runtime value through `unknown`.
        return { code: result.code, map: result.map as import('vite').Rollup.SourceMapInput }
      } catch {
        // A file that fails to stamp (a syntax error Vite itself will also report, or JSX shaped
        // in a way the adapter doesn't recognize) is passed through unstamped rather than failing
        // the whole build — stamping is a nice-to-have for the overlay, never a build gate.
        return null
      }
    },

    configureServer(server: ViteDevServer) {
      const suppressionsPath = join(projectRoot, SUPPRESSIONS_FILENAME)
      const ctx: EditServerContext = {
        registry,
        projectRoot,
        ruleset: recommended,
        suppressionsPath,
        allowedRoot: projectRoot,
      }

      server.middlewares.use(basePath, async (req, res, next) => {
        if (!options.allowRemoteEdits && !isLoopback(req.socket.remoteAddress)) {
          sendJson(res, 403, {
            code: 'RemoteEditsDisabled',
            message: 'edit server is loopback-only',
          })
          return
        }
        if (req.method !== 'POST') {
          next()
          return
        }
        if (req.headers['x-voxfold-token'] !== token) {
          sendJson(res, 403, { code: 'InvalidToken', message: 'missing or invalid session token' })
          return
        }

        const route = req.url?.split('?')[0] ?? ''
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
              next()
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
      })
    },

    transformIndexHtml() {
      return [
        {
          // Config first: a plain inline script, evaluated by the browser directly — no import
          // resolution involved, so it needs no special URL scheme.
          tag: 'script',
          attrs: { type: 'module' },
          injectTo: 'body',
          children: `window.__VOXFOLD__ = ${JSON.stringify({ token, basePath })};`,
        },
        {
          // The bootstrap itself as a STATIC `src=` import, not a dynamic `import("virtual:...")`
          // inside an inline script: a browser resolves a dynamic import() argument as a literal
          // URL (no bare-specifier support, and "virtual:" isn't a URL scheme it understands), so
          // that would always fail with a CORS-flavored "unsupported scheme" error. A `<script
          // src>` URL, by contrast, is a real HTTP request Vite's dev server intercepts and
          // resolves through resolveId/load like any other module URL — `/@id/` is Vite's own
          // documented convention for addressing a plugin-resolved module id directly.
          tag: 'script',
          attrs: { type: 'module', src: VIRTUAL_CLIENT_URL },
          injectTo: 'body',
        },
      ]
    },
  }
}

export default voxfold
