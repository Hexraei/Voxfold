/**
 * HTTP client for the edit server, reached at `/__voxfold/*` (the path `@voxfold/vite`'s
 * `configureServer` middleware listens on). Every method mirrors one handler in
 * `@voxfold/edit-server` 1:1 — same request/response shape, JSON over POST — so the wire format
 * never needs its own separate documentation from the handlers themselves.
 */

import type { NodeRef } from '@voxfold/core'

export interface ApiClientOptions {
  /** Base path the middleware is mounted at. Default '/__voxfold'. */
  basePath?: string
  /** Per-session token injected into the page at bootstrap; sent on every request. */
  token: string
}

export class EditServerApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'EditServerApiError'
    this.code = code
    this.status = status
  }
}

interface PlanTarget {
  ref: NodeRef
  expectedOldText: string
  newText: string
}

export class ApiClient {
  private readonly basePath: string
  private readonly token: string

  constructor(options: ApiClientOptions) {
    this.basePath = options.basePath ?? '/__voxfold'
    this.token = options.token
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.basePath}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-voxfold-token': this.token },
      body: JSON.stringify(body),
    })
    const payload = (await response.json().catch(() => undefined)) as
      | T
      | { code: string; message: string }
      | undefined

    if (!response.ok) {
      const errorBody = payload as { code?: string; message?: string } | undefined
      throw new EditServerApiError(
        errorBody?.code ?? 'UnknownError',
        errorBody?.message ?? `request to ${path} failed with ${response.status}`,
        response.status,
      )
    }
    return payload as T
  }

  resolve(stampId: string): Promise<{
    relativePath: string
    refs: Array<{ ref: NodeRef; editable: boolean; lockReason?: string }>
  }> {
    return this.post('/resolve', { stampId })
  }

  plan(
    relativePath: string,
    targets: PlanTarget[],
  ): Promise<{
    relativePath: string
    fileHash: string
    diffs: Array<{ ref: NodeRef; oldText: string; newText: string }>
  }> {
    return this.post('/plan', { relativePath, targets })
  }

  apply(
    relativePath: string,
    expectedFileHash: string,
    targets: PlanTarget[],
  ): Promise<{ newHash: string; newText: string }> {
    return this.post('/apply', { relativePath, expectedFileHash, targets })
  }

  undo(relativePath: string): Promise<void> {
    return this.post('/undo', { relativePath })
  }

  suppress(relativePath: string, ruleId: string, hash: string): Promise<void> {
    return this.post('/suppress', { relativePath, ruleId, hash })
  }

  openInEditor(relativePath: string, line?: number, column?: number): Promise<void> {
    return this.post('/open-in-editor', { relativePath, line, column })
  }
}
