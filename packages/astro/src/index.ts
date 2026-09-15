/**
 * @voxfold/astro — the Astro integration: stamps `.astro`/`.md`/`.mdx` in dev, serves the edit
 * server over `/__voxfold/*`, and injects the browser overlay's bootstrap script.
 *
 * ARCHITECTURE, following `@voxfold/vite`'s (read that package's `index.ts` first — this mirrors
 * it as closely as Astro's own integration API allows):
 *
 * DEV-ONLY GATING: `@voxfold/vite`'s plugin checks `apply: 'serve'`/`command === 'serve'` at the
 * plugin's own entry point. Astro's `astro:config:setup` hook hands the integration
 * `command: 'dev' | 'build' | 'preview' | 'sync'` directly (verified against Astro 7's own
 * `AstroIntegration` type) — this integration's hook body returns immediately unless
 * `command === 'dev'`, so `updateConfig`/`injectScript` are never even called for a `build`, the
 * same "never touch a production bundle" guarantee the Vite plugin's `apply: 'serve'` gives.
 *
 * WIRING THE STAMP TRANSFORM: `astro:config:setup` calls `updateConfig({ vite: { plugins: [...] }
 * })` with a small Vite plugin (`astroStampPlugin`, below) that stamps `.astro` files via
 * `@voxfold/lang-astro`'s `stamp()` — this is NOT a copy of `@voxfold/vite`'s JSX stamp plugin,
 * since `.astro` is a different format with its own adapter. `enforce: 'pre'` (same as
 * `@voxfold/vite`'s) so it sees the raw `.astro` source before Astro's OWN compiler plugin
 * (`astro:jsx`/the core `astro()` vite plugin, itself registered with `enforce: 'pre'` too —
 * checked directly in `astro`'s own `vite-plugin-astro/index.js`) rewrites it into JS. Ordering
 * within Vite's `pre` tier still follows array order, and Astro merges integration-contributed
 * `vite.plugins` into its config (`integrations/hooks.js`'s `runHookConfigSetup`) separately from
 * where it appends its OWN core plugin — every real-world integration that needs to see raw
 * `.astro` source (this repo could not find a documented alternative hook that fires earlier) uses
 * exactly this `enforce: 'pre'` + `updateConfig` pattern, so it's the defensible choice here too;
 * degrades safely if ever wrong, since a stamp failure is caught and the file passed through
 * unstamped (same fallback `@voxfold/vite`'s transform hook uses).
 *
 * WIRING MARKDOWN/MDX STAMPING: `updateConfig({ markdown: { rehypePlugins: [...] } })` with
 * `@voxfold/lang-markdown/stamp`'s `stampRehype` — Astro's OWN markdown pipeline
 * (`@astrojs/markdown-remark`) already accepts a standard unified `PluggableList` there (checked
 * directly against `@astrojs/markdown-remark`'s own `processor.d.ts`), so no Astro-specific
 * wrapping is needed at all, just passing the plugin through.
 *
 * WIRING THE EDIT SERVER AND OVERLAY: `@voxfold/vite`'s `configureServer(server: ViteDevServer)`
 * hook has a DIRECT equivalent here — Astro's `astro:server:setup` hook hands the integration
 * `server: ViteDevServer`, THE SAME TYPE FROM THE `vite` PACKAGE (verified: `astro`'s own
 * `integrations.d.ts` imports `ViteDevServer` from `'vite'`, not a redefined/wrapped type) —
 * because Astro's dev server IS Vite's dev server underneath. So the edit-server middleware mounts
 * on `server.middlewares` exactly the way `@voxfold/vite` does, zero adaptation needed; this is
 * the one part of the milestone's "if Astro exposes a configureServer-equivalent, use it" question
 * that resolved cleanly rather than needing a workaround.
 *
 * The overlay bootstrap (`client.ts`, next to this file) is exposed as a virtual module the same
 * way `@voxfold/vite`'s is, and injected via `injectScript('page', ...)` instead of
 * `transformIndexHtml` — Astro's own scripts plugin bundles `injectScript('page', content)`'s
 * `content` through Vite's normal module graph (verified against `astro`'s
 * `vite-plugin-scripts/index.js`: the content becomes the body of a synthetic module Vite
 * resolves/loads normally), so a plain `import "virtual:voxfold/client.ts"` string works exactly
 * like the `<script src>` tag the Vite plugin injects.
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
import { astroAdapter } from '@voxfold/lang-astro'
import { markdownAdapter } from '@voxfold/lang-markdown'
import { stampRehype } from '@voxfold/lang-markdown/stamp'
import { recommended } from '@voxfold/rules-recommended'
import type { AstroIntegration } from 'astro'
import type { Root as HastRoot } from 'hast'
import type { VFile } from 'vfile'
import type { Connect, Plugin, ViteDevServer } from 'vite'

export interface VoxfoldAstroOptions {
  /** Mount path for the edit server. Default '/__voxfold'. */
  basePath?: string
  /** Extra CSS selectors the overlay's DOM flattener should skip. */
  skipSelectors?: string[]
  /** Allow non-loopback clients to reach the edit server. Default false — dev-only, local-only. */
  allowRemoteEdits?: boolean
}

const DEFAULT_BASE_PATH = '/__voxfold'
const SUPPRESSIONS_FILENAME = 'voxfold-suppressions.json'
const VIRTUAL_CLIENT_ID = 'virtual:voxfold/client.ts'
const RESOLVED_VIRTUAL_CLIENT_ID = `\0${VIRTUAL_CLIENT_ID}`
// Unlike @voxfold/vite's <script src> tag (which needs the resolved `/@id/__x00__...` URL form
// for a browser-fetched request), injectScript('page', ...) content is a plain JS module BODY
// Vite compiles as part of the bundle — a bare `import "virtual:..."` specifier resolves through
// this plugin's own resolveId/load exactly like any other import, no URL-form rewrite needed.

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

const PREACT_SPECIFIERS = new Set([
  'preact',
  'preact/hooks',
  'preact/jsx-runtime',
  'preact/jsx-dev-runtime',
])

const CLIENT_BARE_SPECIFIERS = [
  '@voxfold/overlay/style.css',
  '@voxfold/overlay/worker',
  '@voxfold/overlay',
]

function resolveClientImports(source: string): string {
  let rewritten = source
  for (const specifier of CLIENT_BARE_SPECIFIERS) {
    const resolved = fileURLToPath(import.meta.resolve(specifier))
    rewritten = rewritten.split(`'${specifier}`).join(`'${resolved}`)
  }
  return rewritten
}

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

/**
 * Vite plugin that stamps `.astro` files with `data-vf` — the `.astro`-specific counterpart to
 * `@voxfold/vite`'s JSX stamp transform. `registry` and `projectRoot` are threaded in from the
 * integration below rather than owned here, since the same registry also needs to accept entries
 * from `stampRehype` (markdown/MDX) and the edit server needs to read from that same registry.
 */
function astroStampPlugin(registry: StampRegistry, getProjectRoot: () => string): Plugin {
  return {
    name: 'voxfold:astro-stamp',
    enforce: 'pre',
    transform(code, id) {
      if (process.env.VITEST) return null // Never stamp inside this monorepo's own test runs.
      if (!id.endsWith('.astro')) return null
      if (id.includes('node_modules')) return null

      const relativePath = relative(getProjectRoot(), id).split('\\').join('/')
      try {
        const result = astroAdapter.stamp!(code, { uri: id, relativePath })
        registry.update(relativePath, 'astro', sha256(code), result.entries)
        return { code: result.code, map: result.map as import('vite').Rollup.SourceMapInput }
      } catch {
        // Same fallback @voxfold/vite's transform uses: stamping is best-effort, never a build
        // gate — a file that fails to stamp is passed through unstamped.
        return null
      }
    },
  }
}

export function voxfoldAstro(options: VoxfoldAstroOptions = {}): AstroIntegration {
  const basePath = options.basePath ?? DEFAULT_BASE_PATH
  const token = randomBytes(16).toString('hex')
  const registry = new StampRegistry([astroAdapter, markdownAdapter])
  let projectRoot = process.cwd()

  return {
    name: 'voxfold',
    hooks: {
      'astro:config:setup': ({ command, updateConfig, injectScript }) => {
        // Dev-only by construction — the same guarantee @voxfold/vite's `apply: 'serve'` gives,
        // but expressed through Astro's own `command` option since Astro integrations have no
        // `apply` field of their own (see module doc).
        if (command !== 'dev') return

        const clientPlugin: Plugin = {
          name: 'voxfold:astro-client',
          resolveId(id) {
            if (id === VIRTUAL_CLIENT_ID) return RESOLVED_VIRTUAL_CLIENT_ID
            if (PREACT_SPECIFIERS.has(id)) return fileURLToPath(import.meta.resolve(id))
            return null
          },
          load(id) {
            if (id === RESOLVED_VIRTUAL_CLIENT_ID) return readClientSource()
            return null
          },
        }

        updateConfig({
          vite: {
            plugins: [astroStampPlugin(registry, () => projectRoot), clientPlugin],
          },
          markdown: {
            rehypePlugins: [
              // A standard `unified` plugin factory — Astro's own markdown pipeline
              // (`@astrojs/markdown-remark`) accepts `markdown.rehypePlugins` as a plain
              // `PluggableList` (verified against its own `processor.d.ts`), so no Astro-specific
              // wrapping is needed beyond providing this shape.
              () => (tree: HastRoot, file: VFile) => {
                const relativePath = file.path
                  ? relative(projectRoot, file.path).split('\\').join('/')
                  : (file.basename ?? 'unknown.md')
                const source = String(file.value)
                return stampRehype(source, {
                  relativePath,
                  onEntries: (entries) => {
                    if (entries.length === 0) return
                    registry.update(relativePath, 'markdown', sha256(source), entries)
                  },
                })(tree)
              },
            ],
          },
        })

        // Config first, then the bootstrap import — both 'page' stage (bundled into every page's
        // own client JS, processed/resolved by Vite): a plain assignment needs no import
        // resolution, so it runs fine as an ordinary inline statement; the bootstrap import is a
        // plain `import "virtual:..."` string, which Vite resolves through the plugin's own
        // resolveId/load above exactly like a real module specifier (verified against Astro's
        // vite-plugin-scripts: injectScript('page', ...) content becomes the body of a synthetic
        // module Vite loads normally — see module doc).
        injectScript('page', `window.__VOXFOLD__ = ${JSON.stringify({ token, basePath })};`)
        injectScript('page', `import ${JSON.stringify(VIRTUAL_CLIENT_ID)};`)
      },

      'astro:server:setup': ({ server }: { server: ViteDevServer }) => {
        projectRoot = server.config.root

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
            sendJson(res, 403, {
              code: 'InvalidToken',
              message: 'missing or invalid session token',
            })
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
    },
  }
}

export default voxfoldAstro
