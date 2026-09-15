import { describe, expect, it } from 'vitest'
import { flattenDocument } from '../src/dom-flatten.ts'
import { handleWorkerRequest } from '../src/worker-handler.ts'
import type { WorkerRequest } from '../src/worker-protocol.ts'

function setBody(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

describe('handleWorkerRequest', () => {
  it('lints a flattened document and reports flags for real tells', () => {
    const body = setBody(
      `<p>We utilize a robust platform every single day for our whole growing team here.</p>`,
    )
    const { blocks } = flattenDocument(body)
    const request: WorkerRequest = {
      type: 'lint',
      requestId: 1,
      document: { uri: 'live', format: 'html', blocks, directives: [] },
    }

    const response = handleWorkerRequest(request)
    expect(response.type).toBe('lint-result')
    if (response.type !== 'lint-result') throw new Error('unreachable')
    expect(response.requestId).toBe(1)
    expect(response.flags.some((f) => f.ruleId === 'utilize')).toBe(true)
  })

  it('echoes the requestId back on both success and error paths', () => {
    const body = setBody(`<p>A perfectly ordinary sentence with no tells in it at all here.</p>`)
    const { blocks } = flattenDocument(body)
    const request: WorkerRequest = {
      type: 'lint',
      requestId: 42,
      document: { uri: 'live', format: 'html', blocks, directives: [] },
    }
    const response = handleWorkerRequest(request)
    expect(response.requestId).toBe(42)
  })

  it('returns an error response instead of throwing when lint() rejects malformed input', () => {
    const request = {
      type: 'lint',
      requestId: 7,
      // Malformed: blocks reference a document but omit required fields lint() needs.
      document: { uri: 'live', format: 'html', blocks: null, directives: [] },
    } as unknown as WorkerRequest

    const response = handleWorkerRequest(request)
    expect(response.type).toBe('error')
    expect(response.requestId).toBe(7)
  })
})
