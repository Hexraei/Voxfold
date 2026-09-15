/**
 * @voxfold/overlay — the dev-only, in-browser overlay: highlights AI-copy tells on the live page
 * and lets a developer edit them in place, writing straight back to the source file through
 * @voxfold/edit-server.
 *
 * Deliberately framework-tooling-agnostic: nothing here depends on Vite-specific import syntax
 * (`?worker`, `?inline`, …), so `@voxfold/vite`'s own dev-server entry point — the thing that
 * actually constructs the Worker and loads `style.css`, both of which need Vite's own module
 * resolution to do correctly — is the one bootstrap script per integration, built against
 * whatever that integration's bundler actually provides.
 */

export { ApiClient, type ApiClientOptions, EditServerApiError } from './api-client.ts'
export { App, type AppProps } from './components/App.tsx'
export {
  type DomFlattenOptions,
  type DomFlattenResult,
  flattenDocument,
  type TextRef,
} from './dom-flatten.ts'
export { createEditorReplica, type EditorReplica } from './editor-replica.ts'
export {
  colorForCategory,
  createHighlightRenderer,
  type HighlightEntry,
  type HighlightRenderer,
  highlightStylesheet,
} from './highlight.ts'
export { mountOverlay, OVERLAY_ROOT_ID, type OverlayMount } from './mount.ts'
export { type FlagDomRange, resolveFlagToDom } from './resolve-flag.ts'
export {
  type LintDocumentInput,
  type LintDocumentResult,
  LintWorkerClient,
} from './worker-client.ts'
export type { LintRequest, WorkerRequest, WorkerResponse } from './worker-protocol.ts'
