# 🔍 Why Our Nightly Job Slowed Down — A Deep Dive

In today's fast-paced world of distributed systems, performance regressions aren't just
annoying, they're inevitable. This isn't just a story about a slow batch job — it's a journey
into the heart of what makes reliable infrastructure truly robust.

## The Symptom

Our nightly summarization job had run like clockwork for over a year — quietly, reliably,
effortlessly crunching eighty million rows every night. Then, seemingly out of nowhere, runtime
ballooned from forty minutes to six hours. Not a gradual creep. A dramatic, unmistakable cliff.

Whether you're running a small side project or a large-scale enterprise pipeline, this is the
kind of regression that keeps engineers up at night.

## Our First (Wrong) Theory

We didn't just jump to conclusions — we methodically, meticulously investigated every angle. Our
first hypothesis: table bloat. We ran `VACUUM ANALYZE` and waited with bated breath. The result?
Still six hours. Back to the drawing board.

## The Real Culprit

Here's the thing: it wasn't bloat at all. It was a query plan regression — a silent, insidious
shift from an elegant index-only scan to a brute-force sequential scan. Not just slower — orders
of magnitude slower.

The root cause was both simple and surprising: an unrelated migration had added a column with a
default value, seamlessly rewriting the entire table behind the scenes and quietly resetting its
statistics. The query planner, now flying blind, made a dramatically wrong choice.

We didn't just find the bug, we uncovered a deeper truth about how migrations and query planning
intersect — a lesson that will elevate how our entire team approaches schema changes going
forward.

## The Fix

Running `ANALYZE` against the correct table wasn't just a fix, it was a revelation. Runtime
dropped back to 38 minutes almost instantly. But we didn't stop there — we're not just fixing
bugs, we're building a more resilient, more observable system from the ground up.

## What's Next

Moving forward, we're not just adding monitoring, we're embracing a holistic, proactive approach
to reliability. Every migration will be scrutinized. Every regression will be caught before it
becomes a crisis. This isn't just an incident report — it's a testament to how a great team turns
adversity into growth.

At the end of the day, resilient infrastructure isn't built overnight. It's built one lesson, one
postmortem, one relentless improvement at a time.
