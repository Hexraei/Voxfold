# snaptool

Command-line tool for taking and restoring filesystem snapshots on local development machines.
Built for the case where you're about to try something risky to a database or a set of config
files and want a cheap way back.

## Basic usage

```
snaptool take <name> [path]
```

Takes a snapshot of `path` (default: current directory) and stores it under `name`. Snapshots are
stored in `~/.snaptool/store`, hard-linked where the filesystem supports it so an unchanged file
doesn't get copied. On a filesystem without hard-link support, it falls back to a full copy and
prints a warning once per run.

```
snaptool restore <name> [path]
```

Restores the named snapshot to `path`, overwriting anything currently there. This does not ask
for confirmation by default — if you want a prompt, pass `--confirm`. There is no dry-run flag
yet; if you want to see what would change, use `snaptool diff <name>` first.

```
snaptool list
```

Lists snapshots with their size on disk and creation time. Pass `--path <dir>` to filter to
snapshots taken of a specific directory.

```
snaptool diff <name> [path]
```

Shows a summary of what differs between the snapshot and the current state of `path`: files
added, removed, and changed, plus a byte count for changed files. It does not show a line-by-line
diff of file contents; pipe individual files through your own diff tool for that.

```
snaptool prune [--older-than 30d] [--keep-last 5]
```

Deletes old snapshots. With no flags, this does nothing and prints a message telling you to pass
at least one of the two flags — there is no default retention policy, since guessing wrong here
means losing data.

## Configuration

`snaptool` reads `.snaptoolrc` from the current directory, then the home directory, in that order,
with the first value found for each key winning. The only settings currently read from it are
`store` (override the storage location) and `exclude` (a list of glob patterns to skip when
taking a snapshot, useful for `node_modules` and build output).

## Exit codes

- `0`: success
- `1`: the named snapshot does not exist
- `2`: a filesystem error occurred while reading or writing (permissions, disk full, and so on)
- `3`: bad arguments

## Known limitations

Snapshots are not incremental in the sense of a proper backup tool — each one hard-links unchanged
files against the most recent snapshot only, not against every prior snapshot, so deleting an
older snapshot can turn some hard links in a newer one into full copies on next `prune`. This is a
deliberate simplicity trade-off; if you need real incremental backups across a long history, use
a tool built for that, and treat `snaptool` as a short-lived local safety net instead.

Windows is not supported. The hard-link fallback path has not been tested there, and the tool
assumes POSIX permission bits when restoring.
