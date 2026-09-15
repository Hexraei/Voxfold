/**
 * Transport-agnostic request handlers. Each takes a plain-object request and returns a plain
 * object result (or throws an `EditServerError`) — no knowledge of HTTP, so the same logic backs
 * Vite's `configureServer` middleware and a future Next.js sidecar without duplication.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'
import type { Flag, LintOptions, NodeRef, RuleSet } from '@voxfold/core'
import { lint } from '@voxfold/core'
import { applyEditRequest, isWriteError, undoLast, type WriteError } from '@voxfold/writer'
import type { ResolvedRef, StampRegistry } from './registry.ts'
import { loadSuppressions, saveSuppressions, writeSuppressionEntry } from './suppressions.ts'

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export class EditServerError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'EditServerError'
    this.code = code
    this.status = status
  }
}

export interface EditServerContext {
  registry: StampRegistry
  projectRoot: string
  ruleset: RuleSet
  suppressionsPath: string
  /** Only paths under here (after resolving `..`) may ever be read or written. */
  allowedRoot: string
}

function assertKnownPath(ctx: EditServerContext, relativePath: string): string {
  const absolute = resolvePath(ctx.projectRoot, relativePath)
  const withinRoot = absolute === ctx.allowedRoot || absolute.startsWith(`${ctx.allowedRoot}/`)
  if (!withinRoot) {
    throw new EditServerError('PathNotAllowed', `${relativePath}: outside the project root`, 403)
  }
  if (!ctx.registry.knownPaths().has(relativePath)) {
    throw new EditServerError(
      'PathNotAllowed',
      `${relativePath}: not a file the stamp transform has seen`,
      403,
    )
  }
  return absolute
}

// ---------------------------------------------------------------------------------------------
// resolve: given a stamp id and the DOM text under it, find the ref (or refs) to edit.
// ---------------------------------------------------------------------------------------------

export interface ResolveRequest {
  stampId: string
}

export interface ResolveResponse {
  relativePath: string
  refs: ResolvedRef[]
}

export function resolve(ctx: EditServerContext, request: ResolveRequest): ResolveResponse {
  const entry = ctx.registry.get(request.stampId)
  if (!entry) {
    throw new EditServerError('UnknownStamp', `no stamp entry for "${request.stampId}"`, 404)
  }
  return {
    relativePath: entry.relativePath,
    refs: entry.refs.map((ref) => ({ ref, editable: true, relativePath: entry.relativePath })),
  }
}

// ---------------------------------------------------------------------------------------------
// plan: preview the diff a set of edits would make, without writing anything.
// ---------------------------------------------------------------------------------------------

export interface PlanTarget {
  ref: NodeRef
  expectedOldText: string
  newText: string
}

export interface PlanRequest {
  relativePath: string
  targets: PlanTarget[]
}

export interface PlanResponse {
  relativePath: string
  fileHash: string
  diffs: Array<{ ref: NodeRef; oldText: string; newText: string }>
}

export async function plan(ctx: EditServerContext, request: PlanRequest): Promise<PlanResponse> {
  const absolute = assertKnownPath(ctx, request.relativePath)
  const adapter = adapterForPath(ctx, request.relativePath)
  const source = await readFile(absolute, 'utf8')
  if (!adapter.writer) {
    throw new EditServerError('NoWriter', `${adapter.id}: this adapter has no writer`, 400)
  }
  const ast = adapter.writer.parse(source)

  const diffs = request.targets.map((target) => {
    const located = adapter.writer!.locate(ast, target.ref)
    if (located.decoded !== target.expectedOldText) {
      throw new EditServerError(
        'StaleTarget',
        `${request.relativePath}: "${target.ref.path}" no longer reads ` +
          `${JSON.stringify(target.expectedOldText)} (now ${JSON.stringify(located.decoded)})`,
        409,
      )
    }
    return { ref: target.ref, oldText: located.decoded, newText: target.newText }
  })

  return { relativePath: request.relativePath, fileHash: sha256(source), diffs }
}

// ---------------------------------------------------------------------------------------------
// apply: actually write the edits, through @voxfold/writer's full verify-then-write protocol.
// ---------------------------------------------------------------------------------------------

export interface ApplyRequest {
  relativePath: string
  expectedFileHash: string
  targets: PlanTarget[]
}

export interface ApplyResponse {
  newHash: string
  newText: string
}

export async function apply(ctx: EditServerContext, request: ApplyRequest): Promise<ApplyResponse> {
  const absolute = assertKnownPath(ctx, request.relativePath)
  const adapter = adapterForPath(ctx, request.relativePath)

  try {
    const result = applyEditRequest(
      {
        file: absolute,
        adapter,
        expectedFileHash: request.expectedFileHash,
        targets: request.targets,
      },
      { projectRoot: ctx.projectRoot },
    )
    return { newHash: result.newHash, newText: result.newText }
  } catch (error) {
    if (isWriteError(error)) {
      throw new EditServerError(error.code, error.message, statusForWriteError(error))
    }
    throw error
  }
}

function statusForWriteError(error: WriteError): number {
  if (error.code === 'StaleSource' || error.code === 'TargetMismatch') return 409
  if (error.code === 'PathOutsideProject' || error.code === 'PathInDenylistedDir') return 403
  if (error.code === 'UntrackedFile') return 403
  return 400
}

// ---------------------------------------------------------------------------------------------
// undo: restore the file from its most recent history entry.
// ---------------------------------------------------------------------------------------------

export interface UndoRequest {
  relativePath: string
}

export async function undo(ctx: EditServerContext, request: UndoRequest): Promise<void> {
  const absolute = assertKnownPath(ctx, request.relativePath)
  const historyDir = join(ctx.projectRoot, '.voxfold', 'history')
  try {
    undoLast(absolute, historyDir)
  } catch (error) {
    if (isWriteError(error)) throw new EditServerError(error.code, error.message, 404)
    throw error
  }
}

// ---------------------------------------------------------------------------------------------
// suppress: write a suppression entry for a flag, keyed the same way the CLI keys them.
// ---------------------------------------------------------------------------------------------

export interface SuppressRequest {
  relativePath: string
  ruleId: string
  hash: string
}

export async function suppress(ctx: EditServerContext, request: SuppressRequest): Promise<void> {
  assertKnownPath(ctx, request.relativePath)
  const existing = (await loadSuppressions(ctx.suppressionsPath)) ?? {
    version: 1 as const,
    files: {},
  }
  writeSuppressionEntry(existing, request.relativePath, request.ruleId, request.hash)
  await saveSuppressions(ctx.suppressionsPath, existing)
}

// ---------------------------------------------------------------------------------------------
// lint: re-lint a file's current content (used after apply/HMR to refresh flags for the overlay's
// own bookkeeping when it can't re-run the in-browser worker, e.g. a first-load ruleset check).
// ---------------------------------------------------------------------------------------------

export interface LintFileRequest {
  relativePath: string
}

export interface LintFileResponse {
  flags: Flag[]
}

export async function lintFile(
  ctx: EditServerContext,
  request: LintFileRequest,
  options: LintOptions = {},
): Promise<LintFileResponse> {
  const absolute = assertKnownPath(ctx, request.relativePath)
  const adapter = adapterForPath(ctx, request.relativePath)
  const source = await readFile(absolute, 'utf8')
  const document = await adapter.extract(source, { uri: request.relativePath })
  const result = lint(document, ctx.ruleset, options)
  return { flags: result.flags }
}

// ---------------------------------------------------------------------------------------------
// open-in-editor: launch the developer's configured editor at the flagged file/line/column.
// ---------------------------------------------------------------------------------------------

export interface OpenInEditorRequest {
  relativePath: string
  line?: number
  column?: number
}

/**
 * `launch-editor` is fire-and-forget by design: it spawns the editor process and its callback
 * fires ONLY on error, asynchronously, after the process actually exits or fails to start — there
 * is no synchronous "it worked" signal to wait on. This handler mirrors that contract honestly:
 * it resolves as soon as the spawn is requested (matching what every editor-launch integration in
 * the wild does — the point is "open my editor," not "block until my editor closes"), and any
 * launch failure is reported to the server's own log rather than to this specific HTTP response,
 * since by the time a spawn failure is known, the response may already have been sent.
 */
export async function openInEditor(
  ctx: EditServerContext,
  request: OpenInEditorRequest,
): Promise<void> {
  const absolute = assertKnownPath(ctx, request.relativePath)
  const target =
    request.line !== undefined
      ? `${absolute}:${request.line}${request.column !== undefined ? `:${request.column}` : ''}`
      : absolute

  const { default: launchEditor } = await import('launch-editor')
  launchEditor(target, (fileName, errorMessage) => {
    console.error(
      `[voxfold] could not open ${fileName} in the editor${errorMessage ? `: ${errorMessage}` : ''}`,
    )
  })
}

function adapterForPath(ctx: EditServerContext, relativePath: string) {
  const format = ctx.registry.formatFor(relativePath)
  if (!format) {
    throw new EditServerError(
      'UnknownStamp',
      `${relativePath}: not a file the stamp transform has seen`,
      404,
    )
  }
  const adapter = ctx.registry.adapterFor(format)
  if (!adapter) throw new EditServerError('UnknownFormat', `no adapter for format "${format}"`, 400)
  return adapter
}
