# Why our nightly job started taking six hours instead of forty minutes

We spent most of Tuesday tracking down a regression in a batch job that summarizes daily usage
data. It had run in around forty minutes for over a year, then one release made it take six
hours, and nobody had touched the job itself. This is the write-up we sent to the rest of the
team afterward.

## The symptom

The job reads about eighty million rows from a table, groups them by account, and writes one
summary row per account to a second table. Runtime had been stable at 35–45 minutes for as long
as anyone could remember. After a deploy on Monday, it took just under six hours, and the on-call
engineer caught it only because a downstream report was late, not because anything alerted.

Nothing in the deploy touched this job's code. The diff for that release was almost entirely in
an unrelated service that shares the same database.

## First (wrong) theory

Our first guess was table bloat — maybe autovacuum had fallen behind and the table needed a
manual vacuum. We ran `VACUUM ANALYZE` on both tables involved. Runtime the next night: still
close to six hours. So that wasn't it, though it was a reasonable first guess given the job's
access pattern and worth ruling out quickly.

## What we found

Query plans for the job's main aggregation query had changed. Before the incident, it used an
index-only scan on `(account_id, event_date)`; after, it used a sequential scan on the full
table. The index still existed and was still valid.

The unrelated deploy had added a new column to the events table with a default value, which
under our Postgres version rewrites the entire table rather than just adding metadata (this
depends on the column type and default; ours was not one of the cheap cases). The rewrite reset
the table's statistics, and the planner's estimate of matching rows for the aggregation query's
filter became wildly wrong, favoring a sequential scan.

`ANALYZE` after the rewrite should have fixed this on its own; the reason it didn't help when we
ran it manually the first time is that we ran it against the wrong table — the job actually reads
from a view that unions two tables, and only one of the two had been rewritten. We were vacuuming
the table we assumed was involved rather than checking which one actually was.

## The actual fix

Running `ANALYZE` against the correct underlying table restored the index-only scan immediately,
and the next night's run finished in 38 minutes. We also added a step to our schema-migration
checklist: any migration that adds a column with a non-trivial default should be followed by an
explicit `ANALYZE` on the affected table, not left to autovacuum's schedule, since autovacuum's
default thresholds mean a large table can go a long time before it's revisited.

## What we're changing

Two follow-ups came out of this. First, the batch job now logs its own runtime to a metrics
system with an alert if it exceeds ninety minutes, so a regression like this pages someone
directly instead of surfacing as "a report was late" hours later. Second, we're adding a
lightweight check in CI that flags migrations adding a column with a default on any table over a
row-count threshold, so the person writing the migration sees a reminder before it ships rather
than after.

Neither of these would have caught the root cause faster on its own, but together they would have
turned a six-hour, day-long investigation into an alert with the actual query plan attached
within the first hour.
