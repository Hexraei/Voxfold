/**
 * The message protocol between the overlay's main-thread code and its Web Worker.
 *
 * `Block[]` is plain, structured-clone-safe data (strings, numbers, plain objects — see
 * `Flag`/`Block` in `@voxfold/core`), so the whole flattened document crosses the worker boundary
 * with a plain `postMessage`. A DOM `Text` node itself is NOT cloneable in any useful way and
 * never leaves the main thread — that's exactly why `flattenDocument` returns a separate
 * `TextRef[]` table instead of embedding real nodes in the blocks it hands to the worker. The
 * main thread re-attaches a flag to its `TextRef` afterward, by `blockId` + `flatRange`, once the
 * worker's response comes back.
 */

import type { Block, Directive, Flag, Format, Score } from '@voxfold/core'

export interface LintRequest {
  type: 'lint'
  requestId: number
  document: {
    uri: string
    format: Format
    blocks: Block[]
    directives: Directive[]
  }
}

export type WorkerRequest = LintRequest

export interface LintResultMessage {
  type: 'lint-result'
  requestId: number
  flags: Flag[]
  score: Score | null
  stats: { words: number; blocks: number; contribution: number }
}

export interface WorkerErrorMessage {
  type: 'error'
  requestId: number
  message: string
}

export type WorkerResponse = LintResultMessage | WorkerErrorMessage
