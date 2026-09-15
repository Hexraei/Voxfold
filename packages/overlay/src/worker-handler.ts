/**
 * The worker's message-handling logic, kept separate from `self.addEventListener` in `worker.ts`
 * so it can be unit-tested as a plain function — `self`/`postMessage` only exist in an actual
 * Worker global scope, which test environments (happy-dom included) don't provide.
 */

import { lint } from '@voxfold/core'
import { recommended } from '@voxfold/rules-recommended'
import type { WorkerRequest, WorkerResponse } from './worker-protocol.ts'

function handleLint(request: Extract<WorkerRequest, { type: 'lint' }>): WorkerResponse {
  const result = lint(request.document, recommended)
  return {
    type: 'lint-result',
    requestId: request.requestId,
    flags: result.flags,
    score: result.score,
    stats: result.stats,
  }
}

export function handleWorkerRequest(request: WorkerRequest): WorkerResponse {
  try {
    if (request.type === 'lint') return handleLint(request)
    // `WorkerRequest` has exactly one variant today. When a second is added, TypeScript will
    // flag the branch above as no longer exhaustive (a missing `case`/`if` for the new type),
    // which is the point at which this line's `request.type` needs a real switch instead of an
    // `if` — deliberately not over-engineered with an unreachable-code assertion for a
    // single-member union.
    throw new Error(`unhandled worker request type: ${(request as { type: string }).type}`)
  } catch (error) {
    return {
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
