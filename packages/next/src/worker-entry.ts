/**
 * A self-contained equivalent of `@voxfold/overlay`'s `worker.ts`, built SEPARATELY from this
 * package's other entries (see `tsdown.config.ts`) with `deps.alwaysBundle` so `@voxfold/core`
 * and `@voxfold/rules-recommended` — left external in `@voxfold/overlay`'s own tsdown build,
 * since that package expects a bundler-aware consumer (Vite) to re-resolve them — are inlined
 * directly into the output instead of staying as bare `import` specifiers.
 *
 * NOT a re-import of `@voxfold/overlay/worker` for its side effect: that module's only job is a
 * top-level `self.addEventListener(...)` call, and `@voxfold/overlay`'s `package.json` declares
 * `"sideEffects": false` — correct for that package's own normal (externals-left-alone) build, but
 * when THIS package's bundler inlines it wholesale, rolldown trusts that flag and tree-shakes the
 * whole side-effecting import away as dead code (confirmed: doing exactly that first produced a
 * literal empty output file). Duplicating the ~3 lines of wiring here, against the same public
 * `handleWorkerRequest`-equivalent logic reimplemented from `lint` + `recommended` (both public
 * exports `@voxfold/overlay` itself also just re-exposes from `@voxfold/core`/
 * `@voxfold/rules-recommended`), sidesteps the tree-shaking problem entirely rather than fighting
 * it with a `sideEffects` override this package doesn't own.
 *
 * WHY THIS FILE EXISTS AT ALL: the sidecar serves this file's compiled output at `GET /worker.js`
 * (see `sidecar.ts`), and the browser bootstrap (`overlay.ts`) loads it into a `Worker` via a
 * `Blob` URL rather than a real module URL — see `overlay.ts`'s module doc for why (no reliable
 * bundler-level worker-asset import syntax works across both this package's own tsdown build and
 * the CONSUMING app's webpack/Turbopack build). A `Blob` URL has no `node_modules` to resolve bare
 * specifiers against, so every dependency this worker touches must already be inlined in the text
 * the sidecar serves.
 */

import { lint } from '@voxfold/core'
import type { WorkerRequest, WorkerResponse } from '@voxfold/overlay'
import { recommended } from '@voxfold/rules-recommended'

function handle(request: WorkerRequest): WorkerResponse {
  try {
    const result = lint(request.document, recommended)
    return {
      type: 'lint-result',
      requestId: request.requestId,
      flags: result.flags,
      score: result.score,
      stats: result.stats,
    }
  } catch (error) {
    return {
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  self.postMessage(handle(event.data))
})
