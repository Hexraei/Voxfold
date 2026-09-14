# Queue API reference

The queue service accepts jobs over HTTP and delivers them to workers over a persistent
connection. This document covers the three endpoints most integrations use: enqueue, status, and
cancel. Authentication uses a bearer token issued from the dashboard; tokens are scoped to a
single project and expire after ninety days.

## POST /v1/jobs

Creates a new job. The body must include a `queue` name and a `payload` object; the payload is
opaque to the service and passed through unmodified to the worker that picks it up. An optional
`priority` field accepts an integer from 0 to 9, where 9 is processed first. Jobs without a
priority default to 5.

The response includes the job id, its initial status (`queued`), and the estimated position in
the queue at the time of the request. That position is not a guarantee; jobs ahead of it can be
cancelled or fail, which changes it, and workers can be added or removed at any time.

If the named queue does not exist, it is created automatically on first use. There is no separate
endpoint for declaring a queue in advance. Queue names are limited to 64 characters and must
match `[a-z0-9-]+`; anything else returns a 400 with a message naming the invalid character.

## GET /v1/jobs/:id

Returns the current status of a job: `queued`, `running`, `succeeded`, `failed`, or `cancelled`.
Once a job reaches `succeeded` or `failed` its result is retained for 30 days and then deleted.
Requesting a job past that window returns 404, the same response as requesting an id that never
existed — the service does not distinguish "expired" from "never existed" to avoid leaking
information about job volume to callers who should not have access to a given id.

The response for a `failed` job includes an `error` object with a `message` and, when the worker
reported one, a `code`. Codes are worker-defined; the service does not interpret them.

## DELETE /v1/jobs/:id

Requests cancellation of a job. If the job is still `queued`, it is removed and the response
reflects `cancelled` immediately. If the job is already `running`, cancellation is best-effort:
the service asks the worker to stop, but a worker mid-task may finish anyway before it checks in.
Poll the status endpoint to see the actual outcome rather than assuming cancellation succeeded.

Jobs that have already reached a terminal state cannot be cancelled; the endpoint returns 409 in
that case along with the job's actual status, so a caller can tell the difference between "too
late" and "the id was wrong."

## Rate limits

Each token is limited to 200 requests per minute across all endpoints. The limit is enforced with
a sliding window, and the response includes `X-RateLimit-Remaining` and `X-RateLimit-Reset`
headers on every request, not just ones that hit the limit. A 429 response includes a
`Retry-After` header in seconds.

Enqueue requests count double against the limit relative to status checks, since they do more
work on the service side. This is the main reason high-volume integrations should batch jobs
into fewer, larger payloads rather than enqueueing one job per unit of work.

## Webhooks

Instead of polling, a project can register a webhook URL that receives a POST for every status
change. Webhook delivery is at-least-once: a network failure or timeout on our side triggers a
retry with exponential backoff, up to six attempts over roughly ten minutes. A receiving endpoint
should treat delivery as idempotent, using the `event_id` field to deduplicate, since a retried
delivery for the same event will otherwise be indistinguishable from a new one downstream.

Webhook payloads are signed with an HMAC over the raw request body, using a per-project secret
shown once at creation time. Verify the signature before trusting the payload; anyone who knows
the webhook URL can otherwise post a fabricated status update.
