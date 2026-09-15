import { describe, expect, it, vi } from 'vitest'
import { STICKY_MARKER } from '../src/comment.ts'
import type { OctokitLike } from '../src/sticky-comment.ts'
import { upsertStickyComment } from '../src/sticky-comment.ts'

function fakeOctokit(comments: Array<{ id: number; body?: string }>): {
  octokit: OctokitLike
  updateComment: ReturnType<typeof vi.fn>
  createComment: ReturnType<typeof vi.fn>
} {
  const updateComment = vi.fn().mockResolvedValue({})
  const createComment = vi.fn().mockResolvedValue({})
  const octokit: OctokitLike = {
    rest: {
      issues: {
        listComments: vi.fn().mockResolvedValue({ data: comments }),
        updateComment,
        createComment,
      },
    },
  }
  return { octokit, updateComment, createComment }
}

describe('upsertStickyComment', () => {
  it('creates a new comment when none carries the marker', async () => {
    const { octokit, createComment, updateComment } = fakeOctokit([
      { id: 1, body: 'unrelated comment' },
    ])
    const result = await upsertStickyComment(
      octokit,
      'acme',
      'widgets',
      42,
      `${STICKY_MARKER}\nbody`,
    )
    expect(result).toBe('created')
    expect(createComment).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'widgets',
      issue_number: 42,
      body: `${STICKY_MARKER}\nbody`,
    })
    expect(updateComment).not.toHaveBeenCalled()
  })

  it('updates the existing sticky comment when found', async () => {
    const { octokit, createComment, updateComment } = fakeOctokit([
      { id: 1, body: 'unrelated' },
      { id: 7, body: `${STICKY_MARKER}\nold body` },
    ])
    const result = await upsertStickyComment(
      octokit,
      'acme',
      'widgets',
      42,
      `${STICKY_MARKER}\nnew body`,
    )
    expect(result).toBe('updated')
    expect(updateComment).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'widgets',
      comment_id: 7,
      body: `${STICKY_MARKER}\nnew body`,
    })
    expect(createComment).not.toHaveBeenCalled()
  })

  it('does not duplicate across repeated runs', async () => {
    const comments: Array<{ id: number; body?: string }> = []
    const octokit: OctokitLike = {
      rest: {
        issues: {
          listComments: vi.fn().mockImplementation(() => Promise.resolve({ data: comments })),
          updateComment: vi.fn().mockImplementation(({ comment_id, body }) => {
            const c = comments.find((x) => x.id === comment_id)
            if (c) c.body = body
            return Promise.resolve({})
          }),
          createComment: vi.fn().mockImplementation(({ body }) => {
            comments.push({ id: comments.length + 1, body })
            return Promise.resolve({})
          }),
        },
      },
    }
    await upsertStickyComment(octokit, 'a', 'b', 1, `${STICKY_MARKER}\nfirst`)
    await upsertStickyComment(octokit, 'a', 'b', 1, `${STICKY_MARKER}\nsecond`)
    expect(comments).toHaveLength(1)
    expect(comments[0]?.body).toBe(`${STICKY_MARKER}\nsecond`)
  })
})
