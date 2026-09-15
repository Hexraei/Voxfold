/** Upsert one PR comment carrying the sticky marker: list, find, PATCH or POST. */

import { STICKY_MARKER } from './comment.ts'

// Structurally typed to the handful of Octokit REST calls used, so tests can inject a minimal
// fake without pulling in @octokit's real types.
export interface OctokitLike {
  rest: {
    issues: {
      listComments: (params: {
        owner: string
        repo: string
        issue_number: number
      }) => Promise<{ data: Array<{ id: number; body?: string | null | undefined }> }>
      updateComment: (params: {
        owner: string
        repo: string
        comment_id: number
        body: string
      }) => Promise<unknown>
      createComment: (params: {
        owner: string
        repo: string
        issue_number: number
        body: string
      }) => Promise<unknown>
    }
  }
}

export async function upsertStickyComment(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<'updated' | 'created'> {
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
  })
  const existing = comments.find((c) => c.body?.includes(STICKY_MARKER))

  if (existing) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body })
    return 'updated'
  }

  await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body })
  return 'created'
}
