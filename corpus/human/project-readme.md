# retrykit

A small library for retrying failed operations with backoff, jitter, and a budget. Written
because every project seems to reinvent this, usually badly, usually without jitter, and usually
without a way to give up.

## Why

Most retry libraries give you a number of attempts and a delay. That's fine until two services
call each other under load and their retries synchronize into a thundering herd, or a retry loop
runs for ten minutes because nobody set an upper bound on total time spent. retrykit tries to make
the safe defaults the easy ones: jitter is on by default, and every retry has a total time budget,
not just a count.

## Install

```
npm install retrykit
```

Requires Node 18 or later. There are no other runtime dependencies.

## Usage

```js
import { retry } from 'retrykit'

const result = await retry(() => fetchFromFlakyService(), {
  attempts: 5,
  baseDelayMs: 200,
  budgetMs: 10_000,
})
```

`attempts` caps the number of tries. `budgetMs` caps total wall-clock time regardless of how many
attempts remain; if the budget runs out mid-backoff, the function throws the last error rather
than waiting further. Both limits apply — whichever is hit first stops the retries.

By default, every error is treated as retryable. Pass `shouldRetry(error)` to narrow that down,
for example to stop retrying on a 4xx response but keep retrying on 5xx and network errors.

```js
await retry(() => callApi(), {
  shouldRetry: (err) => err.status >= 500 || err.code === 'ECONNRESET',
})
```

## Backoff

The default backoff is exponential with full jitter: each delay is a random value between 0 and
`baseDelayMs * 2^attempt`, capped at `maxDelayMs` (default 30 seconds). This is the approach AWS
described in their 2015 architecture blog post on backoff strategies, and it holds up well in
practice — plain exponential backoff without jitter tends to produce correlated retry bursts
across many clients.

A custom backoff function can be supplied instead:

```js
await retry(fn, {
  backoff: (attempt) => attempt * 500,
})
```

## What this library does not do

It does not implement a circuit breaker. If a dependency is down, retrying with backoff still
sends it traffic, just less of it over time. For a dependency that's expected to be down for a
while, pair this with a circuit breaker library, or track failure rates yourself and stop calling
`retry` entirely once a threshold is crossed.

It also does not do anything with logging or metrics. Wrap the function passed to `retry` if you
want to record attempt counts or timing.

## Testing

The test suite mocks `Date.now` and `setTimeout` to run the backoff logic without real delays, so
`npm test` finishes in under a second even though it covers scenarios with dozens of simulated
attempts and multi-minute budgets. See `test/backoff.test.js` for the fake timer setup if you're
adding a new backoff strategy and want a template.

## License

MIT
