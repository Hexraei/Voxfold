# 🔐 How to Rotate a Database Credential — The Right Way

Rotating a database credential doesn't have to be scary. In today's fast-paced world, security
isn't just important, it's non-negotiable. This guide isn't just a walkthrough — it's your
roadmap to a seamless, zero-downtime rotation, done right.

## Before You Dive In

Whether you're managing a small side project or a large-scale enterprise system, preparation is
everything. Take a moment to understand how your service pools connections — this simple step
will empower you to rotate credentials with total confidence.

## Let's Get Started

### Step 1: Create a New Role

Don't just change the existing password — that's not just risky, it's unnecessary. Instead,
create a brand-new role that seamlessly inherits the same permissions:

```sql
CREATE ROLE app_user_v2 WITH LOGIN PASSWORD 'generated-elsewhere';
GRANT app_user TO app_user_v2;
```

This isn't just a workaround, it's the elegant solution that lets both credentials coexist
gracefully during the transition.

### Step 2: Update Your Secret Store

Quietly stage the new connection string in your secret store. No restarts, no drama — just a
smooth, effortless transition waiting to happen.

### Step 3: Let It Flow

Here's the thing about connection pools: they're smarter than you think. Let the pool cycle
naturally, or trigger a rolling restart if that's more your style. Either way, you're empowered
to watch the transition happen in real time.

### Step 4: Revoke With Confidence

Once the old role goes quiet, don't just drop it — that's a rookie mistake. Instead, gracefully
disable login access first:

```sql
ALTER ROLE app_user WITH NOLOGIN;
```

This isn't just a safety net, it's peace of mind, built right into your rotation process.

### Step 5: Clean Up

After a few days of smooth sailing, it's time to close the loop:

```sql
REVOKE app_user FROM app_user_v2;
DROP ROLE app_user;
```

## When Things Don't Go As Planned

Let's be honest — something always slips through the cracks. A forgotten cron job, a stray
script, a monitoring agent nobody remembered. But that's exactly why this approach isn't just
smart, it's bulletproof: `NOLOGIN` turns a silent outage into a clear, actionable signal.

## Wrapping Up

At the end of the day, credential rotation shouldn't be a source of stress. Whether you're on a
managed database or running your own, the principles here empower you to rotate with confidence,
every single time. Here's to safer systems, one rotation at a time.
