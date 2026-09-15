/**
 * @voxfold/edit-server — transport-agnostic handlers behind the overlay's edit flow.
 *
 * Every handler here is a plain async function: request in, response out (or a thrown
 * `EditServerError`). No HTTP, no framework — `@voxfold/vite` wires these to `configureServer`
 * middleware, and a future Next.js sidecar would wire the same functions to its own HTTP server.
 */

export {
  type ApplyRequest,
  type ApplyResponse,
  apply,
  type EditServerContext,
  EditServerError,
  type LintFileRequest,
  type LintFileResponse,
  lintFile,
  type OpenInEditorRequest,
  openInEditor,
  type PlanRequest,
  type PlanResponse,
  type PlanTarget,
  plan,
  type ResolveRequest,
  type ResolveResponse,
  resolve,
  type SuppressRequest,
  suppress,
  type UndoRequest,
  undo,
} from './handlers.ts'
export { type ResolvedRef, StampRegistry } from './registry.ts'
export { loadSuppressions, saveSuppressions, writeSuppressionEntry } from './suppressions.ts'
