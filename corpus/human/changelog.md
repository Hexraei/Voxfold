# Changelog

## 2.4.0

### Added

- `export --format ndjson` writes newline-delimited JSON instead of a single array, which is
  easier to stream into tools that read line by line. The existing `--format json` output is
  unchanged.
- Config files can now set `defaultTimezone`, used when a date in the input has no explicit
  offset. Previously these were always interpreted as UTC, which was a frequent source of
  off-by-one-day bugs for users in other timezones.
- New `--dry-run` flag on `import`, which parses and validates the input file and reports what
  would be inserted without touching the database.

### Changed

- `validate` now checks that referenced ids actually exist before reporting a file as valid,
  rather than only checking shape. This may surface errors in files that previously passed;
  if you relied on the old, shallower check, pin to 2.3.x until you've addressed them.
- Error messages from `import` now include the line number of the offending record. Previously
  they included only the record's index within the file, which was harder to map back to the
  source file by hand.

### Fixed

- `export` no longer includes soft-deleted records by default. This was always the intent, but a
  join condition was missing an `AND deleted_at IS NULL` clause, so a deleted record's export
  survived until the retention job ran. Use `--include-deleted` if you actually want them.
- Fixed a crash in `import` when a CSV file's last line had no trailing newline.
- `--config` now correctly resolves a relative path against the current working directory
  instead of the directory containing the binary, matching the documented behavior.

### Deprecated

- `--legacy-auth` is deprecated and will be removed in 3.0. Use `--token` instead; see the
  migration note in `docs/auth.md` for the mapping between old and new credential formats.

## 2.3.2

### Fixed

- Retry logic in the HTTP client no longer retries on 401 responses, which previously caused a
  five-attempt delay before surfacing what should have been an immediate authentication error.

## 2.3.1

### Fixed

- Fixed a memory leak in long-running `watch` mode: a listener registered on each file-change
  event was never removed, so memory usage grew roughly linearly with the number of changes
  observed over a session. Sessions longer than a few hours were the most affected.

## 2.3.0

### Added

- `watch` mode, which re-runs validation whenever a watched file changes. Accepts the same
  `--config` and `--strict` flags as a normal run.

### Changed

- The default log level is now `warn` instead of `info`. Set `--log-level info` to restore the
  previous verbosity.
