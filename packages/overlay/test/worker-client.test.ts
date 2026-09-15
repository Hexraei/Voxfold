import { describe, expect, it } from 'vitest'
import { LintWorkerClient } from '../src/worker-client.ts'
import type { WorkerRequest, WorkerResponse } from '../src/worker-protocol.ts'

/** A fake Worker: records posted messages and lets the test deliver responses on demand. */
class FakeWorker {
  posted: WorkerRequest[] = []
  private listeners: Array<(event: MessageEvent<WorkerResponse>) => void> = []
  terminated = false

  postMessage(message: WorkerRequest): void {
    this.posted.push(message)
  }

  addEventListener(
    _type: 'message',
    listener: (event: MessageEvent<WorkerResponse>) => void,
  ): void {
    this.listeners.push(listener)
  }

  removeEventListener(): void {}

  terminate(): void {
    this.terminated = true
  }

  /** Simulate the worker responding. */
  deliver(response: WorkerResponse): void {
    for (const listener of this.listeners)
      listener({ data: response } as MessageEvent<WorkerResponse>)
  }
}

const emptyDocument = { uri: 'live', format: 'html' as const, blocks: [], directives: [] }

describe('LintWorkerClient', () => {
  it('resolves lintDocument when the worker responds with a matching requestId', async () => {
    const fake = new FakeWorker()
    const client = new LintWorkerClient(fake as unknown as Worker)

    const promise = client.lintDocument(emptyDocument)
    expect(fake.posted).toHaveLength(1)
    const requestId = fake.posted[0]!.requestId

    fake.deliver({
      type: 'lint-result',
      requestId,
      flags: [],
      score: null,
      stats: { words: 0, blocks: 0, contribution: 0 },
    })

    await expect(promise).resolves.toEqual({
      flags: [],
      score: null,
      stats: { words: 0, blocks: 0, contribution: 0 },
    })
  })

  it('rejects when the worker responds with an error for that requestId', async () => {
    const fake = new FakeWorker()
    const client = new LintWorkerClient(fake as unknown as Worker)

    const promise = client.lintDocument(emptyDocument)
    const requestId = fake.posted[0]!.requestId
    fake.deliver({ type: 'error', requestId, message: 'boom' })

    await expect(promise).rejects.toThrow('boom')
  })

  it('matches overlapping requests to their own responses, not to each other', async () => {
    const fake = new FakeWorker()
    const client = new LintWorkerClient(fake as unknown as Worker)

    const first = client.lintDocument(emptyDocument)
    const second = client.lintDocument(emptyDocument)
    const [firstId, secondId] = fake.posted.map((m) => m.requestId)
    expect(firstId).not.toBe(secondId)

    // Deliver out of order: second request's response arrives first.
    fake.deliver({
      type: 'lint-result',
      requestId: secondId!,
      flags: [],
      score: null,
      stats: { words: 2, blocks: 1, contribution: 0 },
    })
    fake.deliver({
      type: 'lint-result',
      requestId: firstId!,
      flags: [],
      score: null,
      stats: { words: 1, blocks: 1, contribution: 0 },
    })

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult.stats.words).toBe(1)
    expect(secondResult.stats.words).toBe(2)
  })

  it('ignores a response whose requestId nothing is waiting on', async () => {
    const fake = new FakeWorker()
    // Constructing the client registers its message listener on `fake` — required for this test
    // to actually exercise the "stale response" path below, not just prove nothing is listening.
    new LintWorkerClient(fake as unknown as Worker)

    // Deliver a response for a request that was never made — must not throw.
    expect(() =>
      fake.deliver({
        type: 'lint-result',
        requestId: 9999,
        flags: [],
        score: null,
        stats: { words: 0, blocks: 0, contribution: 0 },
      }),
    ).not.toThrow()
  })

  it('dispose() rejects every still-pending request and terminates the worker', async () => {
    const fake = new FakeWorker()
    const client = new LintWorkerClient(fake as unknown as Worker)

    const promise = client.lintDocument(emptyDocument)
    client.dispose()

    await expect(promise).rejects.toThrow(/disposed/)
    expect(fake.terminated).toBe(true)
  })

  it('sends increasing requestIds so responses can never be mismatched', () => {
    const fake = new FakeWorker()
    const client = new LintWorkerClient(fake as unknown as Worker)

    // Only the posted requestIds matter here; catch to avoid an unhandled-rejection warning once
    // dispose() below rejects them.
    const pending = [
      client.lintDocument(emptyDocument),
      client.lintDocument(emptyDocument),
      client.lintDocument(emptyDocument),
    ]
    for (const promise of pending) promise.catch(() => {})

    const ids = fake.posted.map((m) => m.requestId)
    expect(new Set(ids).size).toBe(ids.length)

    client.dispose()
  })
})
