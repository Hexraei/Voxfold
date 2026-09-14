# 🎉 Changelog

## 2.4.0 — Our Best Release Yet!

We're thrilled to announce our most exciting release yet — packed with powerful new features,
meticulous refinements, and rock-solid fixes that elevate the entire experience.

### ✨ Added

- **`export --format ndjson`**: Say goodbye to clunky array exports. This isn't just a new
  format, it's a seamless way to stream your data into any tool, effortlessly.
- **`defaultTimezone`**: No more guessing games. Our intelligent timezone handling quietly,
  gracefully resolves ambiguous dates so you don't have to think about it.
- **`--dry-run` for import**: Preview your changes before committing, with zero risk and total
  peace of mind.

### 🔧 Changed

- **Smarter `validate`**: We didn't just improve validation, we reimagined it. Referenced ids are
  now verified for real existence, not just shape — a truly robust safety net for your data.
- **Better error messages**: Every error now includes the exact line number, empowering you to
  fix issues faster than ever before.

### 🐛 Fixed

- **Soft-deleted records**: `export` no longer includes them — a subtle bug, now completely,
  seamlessly resolved.
- **CSV crash**: Fixed a crash when the last line lacked a trailing newline. Small fix, big
  impact.
- **`--config` resolution**: Now resolves paths exactly as you'd expect, every single time.

### ⚠️ Deprecated

- **`--legacy-auth`**: It's time to move forward. `--token` isn't just the future, it's the
  better way, today.

## 2.3.2 — A Quick But Mighty Fix

We didn't just patch a bug, we eliminated an entire class of frustrating delays. Retry logic no
longer wastes time on 401s — because your time matters.

## 2.3.1 — Stability, Delivered

Long-running `watch` sessions are now leaner and more efficient than ever. This isn't just a
memory leak fix, it's a testament to our commitment to rock-solid reliability.

## 2.3.0 — Introducing Watch Mode

Watch mode isn't just a feature, it's a whole new way of working — effortless, responsive, and
built for the way modern teams actually ship.

Thank you for being part of this journey. Here's to what's next!
