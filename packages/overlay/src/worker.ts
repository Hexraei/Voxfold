/**
 * Web Worker entry point: lints the flattened document off the main thread, so a page with a lot
 * of text never causes the overlay itself to jank the page it's inspecting.
 *
 * The ruleset (`@voxfold/rules-recommended`) is bundled directly into this worker rather than
 * fetched from the edit server at runtime: it's the same static data every build ships, and
 * loading it locally means the very first lint (on page load, before any network round trip)
 * still runs immediately.
 */

import { handleWorkerRequest } from './worker-handler.ts'
import type { WorkerRequest } from './worker-protocol.ts'

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  self.postMessage(handleWorkerRequest(event.data))
})
