# Security notes: the dev-only edit server

Every dev integration (`@voxfold/vite`, `@voxfold/astro`, `@voxfold/next`) runs a local HTTP
server that can read and write files in your project while `dev` is running. This is reviewed
here on its own, since it's the one part of Voxfold with write access to your source tree.

## Threat model

The server is **local-development-only**, never present in a production build (each
integration checks `command === 'dev'` / `NODE_ENV !== 'production'` before mounting
anything), and its trust boundary is the machine it runs on — a process able to reach a
loopback-bound server already has filesystem-equivalent access to the project. It is not
designed to resist an attacker who already has arbitrary code execution on your machine.

## What it guards against

- **Remote access**: bound to `127.0.0.1`; a request from any other address is refused
  (`RemoteEditsDisabled`) unless the integration is explicitly configured with
  `allowRemoteEdits: true`.
- **Cross-tab / cross-origin requests**: every mutating route requires a per-session random
  token (16 bytes, generated fresh on each dev-server start) sent as a header. A page from a
  different origin — including another tab on `localhost` — cannot forge this without first
  reading it from the same loopback-bound server, which the origin check above already blocks.
- **Writing outside the project**: a write target is resolved and checked against the project
  root twice, independently — once by the edit server before dispatch, and again by
  `@voxfold/writer`'s own path guard, which resolves symlinks (`realpathSync`) before the
  containment check, so a symlink planted inside the project pointing outside it is still
  caught.
- **Writing files the stamp transform never actually saw**: every write target must match an
  entry in the in-memory stamp registry, populated only by the dev-time compile step actually
  processing that file — a request naming an arbitrary path fails this check even if it also
  happens to pass the path-containment check above.
- **Writing to `node_modules`/`.git`**: denylisted explicitly, regardless of the project-root
  check.
- **Writing an untracked file**: refused by default (`UntrackedFile`) unless the writer is
  explicitly configured to allow it — a write landing in a file with no git history to fall
  back on is a strictly worse failure mode than refusing.
- **A stale or hand-edited file**: every write is preceded by a hash check against the file's
  on-disk content and a structural re-parse after patching; a mismatch anywhere in that chain
  refuses the write rather than guessing.

## Accepted, documented trade-offs

- **The session token comparison is a plain string comparison, not constant-time.** Given the
  token is random and high-entropy, and the only path to it is already loopback-bound, a
  timing attack here has no realistic exploitation path in this threat model.
- **Next.js's `/register` route (the build-time stamp loader reporting to the sidecar) has no
  token check**, only the same loopback gate as everything else. The loader process already
  has full filesystem access equal to the sidecar's own — requiring a token here would add no
  real boundary, only a chicken-and-egg problem for how the loader would learn it.
- **The GET routes serving static assets** (session token, worker bundle, stylesheet) are
  loopback-gated but not token-gated, since the token itself is one of them — the first
  authenticated call has to come from somewhere.
