# How to rotate a database credential without downtime

This guide covers rotating a Postgres user's password for a service that reads its connection
string from an environment variable, without restarting the service or causing a window of
failed connections. It assumes you can create a second database role and that the service
reconnects on a normal schedule rather than holding one connection open forever.

## Before you start

Check how your service pools connections. If it uses a connection pool with a maximum connection
lifetime (most poolers support this), rotation is straightforward, because old connections using
the old password will cycle out naturally. If it opens one connection at startup and never
recycles it, you'll need to restart the service as part of this process, and the "no downtime"
approach below does not apply as written.

Confirm you have a way to roll back the change to your secret store before you touch the
database. If step 3 fails partway through, you want to be able to put the old password back
immediately rather than debug under pressure.

## Steps

1. **Create a new role with the same permissions as the existing one**, rather than changing the
   existing role's password directly. This lets both the old and new credentials work
   simultaneously during the transition.

   ```sql
   CREATE ROLE app_user_v2 WITH LOGIN PASSWORD 'generated-elsewhere';
   GRANT app_user TO app_user_v2;
   ```

   Granting the old role to the new one is the easiest way to copy its permissions if they were
   assigned via role membership rather than directly; if permissions were granted directly to the
   old role, you'll need to re-grant them explicitly to the new one instead.

2. **Update the secret store with the new connection string**, but do not restart the service
   yet. Most services read environment variables only at startup, so this step alone changes
   nothing about running instances — it just stages the new value for the next restart or the
   next time your deployment tooling picks up secrets.

3. **Let the connection pool cycle naturally**, or trigger a rolling restart if your deployment
   setup supports one and your pool doesn't expire connections on its own. Watch connection
   counts on both the old and new role during this window; you should see the old role's count
   fall as the new role's count rises.

4. **Once the old role has zero active connections for a sustained period** (ten minutes is a
   reasonable default, longer if your service has infrequent traffic), revoke its ability to log
   in rather than dropping it immediately:

   ```sql
   ALTER ROLE app_user WITH NOLOGIN;
   ```

   Leaving the role in place but unable to log in gives you a fast rollback path if you discover
   something is still using the old credential somewhere you didn't expect.

5. **After a few days with no issues**, drop the old role and revoke its grant on the new one if
   you no longer need the permission chain:

   ```sql
   REVOKE app_user FROM app_user_v2;
   DROP ROLE app_user;
   ```

## Things that go wrong

The most common failure is a service or script you forgot about that still holds the old
connection string — a cron job, an admin script run from someone's laptop, a monitoring agent.
Setting the old role to `NOLOGIN` instead of dropping it immediately (step 4) is what turns this
from an outage into a clear, specific error message pointing at exactly what still needs
updating.

If you're on a managed database where you don't control roles directly, check whether the
provider exposes a similar "create a second credential, then revoke the first" flow — most do,
under names like "credential rotation" or "additional user."
