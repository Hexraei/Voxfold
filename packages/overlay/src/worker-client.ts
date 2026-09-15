/**
 * Main-thread client for the lint worker: turns the request/response message protocol into a
 * plain async function, matching responses back to callers by `requestId` so overlapping lint
 * requests (a fast series of DOM mutations, each triggering a re-lint) never cross-deliver.
 */

import type { Block, Directive, Flag, Format, Score } from '@voxfold/core'
import type { LintResultMessage, WorkerRequest, WorkerResponse } from './worker-protocol.ts'

export interface LintDocumentInput {
  uri: string
  format: Format
  blocks: Block[]
  directives: Directive[]
}

export interface LintDocumentResult {
  flags: Flag[]
  score: Score | null
  stats: { words: number; blocks: number; contribution: number }
}

export class LintWorkerClient {
  private readonly worker: Worker
  private nextRequestId = 1
  private readonly pending = new Map<
    number,
    { resolve: (result: LintDocumentResult) => void; reject: (error: Error) => void }
  >()

  constructor(worker: Worker) {
    this.worker = worker
    this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      this.handleMessage(event.data)
    })
  }

  private handleMessage(response: WorkerResponse): void {
    const entry = this.pending.get(response.requestId)
    if (!entry) return // A stale response for a request nobody is waiting on anymore.
    this.pending.delete(response.requestId)

    if (response.type === 'error') {
      entry.reject(new Error(response.message))
      return
    }
    entry.resolve(toResult(response))
  }

  lintDocument(document: LintDocumentInput): Promise<LintDocumentResult> {
    const requestId = this.nextRequestId++
    const request: WorkerRequest = { type: 'lint', requestId, document }
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      this.worker.postMessage(request)
    })
  }

  /** Reject every in-flight request (e.g. before tearing down the overlay) rather than leak them. */
  dispose(): void {
    for (const entry of this.pending.values()) {
      entry.reject(new Error('LintWorkerClient disposed while a request was still pending'))
    }
    this.pending.clear()
    this.worker.terminate()
  }
}

function toResult(message: LintResultMessage): LintDocumentResult {
  return { flags: message.flags, score: message.score, stats: message.stats }
}
