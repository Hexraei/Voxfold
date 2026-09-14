/**
 * URL fetching: `voxfold https://yoursite.com`.
 *
 * Native fetch, no headless browser. That means client-rendered pages return an empty shell —
 * intentionally out of scope per the project's non-goals — so detecting that case and saying so
 * plainly matters more here than almost anywhere else: a false "100/A" for a page we never
 * actually read would be worse than useless, it would be actively misleading.
 */

import type { ProseDocument } from '@voxfold/core'
import { htmlAdapter, isClientRenderedShell } from '@voxfold/lang-html'

const MAX_BYTES = 5 * 1024 * 1024

export interface FetchResult {
  document: ProseDocument
  isShell: boolean
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message)
    this.name = 'FetchError'
  }
}

export async function fetchAndExtract(url: string, userAgent: string): Promise<FetchResult> {
  let response: Response
  try {
    response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': userAgent, accept: 'text/html,*/*' },
    })
  } catch (error) {
    throw new FetchError(`could not reach ${url}: ${(error as Error).message}`, url)
  }

  if (!response.ok) {
    throw new FetchError(`${url} responded ${response.status} ${response.statusText}`, url)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('html') && contentType.length > 0) {
    throw new FetchError(`${url} is not HTML (content-type: ${contentType})`, url)
  }

  const buffer = await readCapped(response, MAX_BYTES, url)
  const html = new TextDecoder('utf-8').decode(buffer)

  const document = (await htmlAdapter.extract(html, { uri: url })) as ProseDocument
  return { document, isShell: isClientRenderedShell(html, document) }
}

async function readCapped(response: Response, maxBytes: number, url: string): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer())

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new FetchError(`${url} exceeds the ${maxBytes / 1024 / 1024}MB fetch limit`, url)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export const SPA_SHELL_MESSAGE =
  'Client-rendered page: server HTML has no content to lint. Run voxfold against your source files instead.'
