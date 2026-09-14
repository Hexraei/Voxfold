# Calibration corpus sources

## `corpus/human/`

Self-authored, plain technical and narrative prose, written for this repo with no AI
involvement in the writing itself, and deliberately not policed for the tells voxfold looks for
(no cherry-picking clean sentences — this is what ordinary careful writing looks like when
nobody is optimizing against a linter). Covers a spread of genres: API docs, a project README, a
CLI help page, a technical blog post, a changelog, and a short how-to guide.

Third-party permissively licensed pre-2022 text was considered (per the build plan) but requires
network access to fetch, which this environment does not have. Rather than commit text whose
license can't be verified, or fabricate a source, every file here is original writing, disclosed
as such. If real third-party corpus text is added later, list each URL and its license below
before fetching it into the gitignored cache — do not commit fetched pages directly.

| File | Genre | Words (approx) |
|---|---|---|
| `api-reference.md` | API reference docs | 550 |
| `project-readme.md` | Open-source project README | 480 |
| `cli-help.md` | CLI usage guide | 420 |
| `engineering-notes.md` | Technical blog / postmortem style | 600 |
| `changelog.md` | Release notes | 380 |
| `howto-guide.md` | Task-oriented how-to | 460 |

## `corpus/ai-style/`

Self-authored samples written deliberately in the recognizable AI-marketing-copy voice the tool
targets (em dashes, "not just X, it's Y", tricolons, buzzwords, empty superlatives). These are
not real AI model output — they're hand-written to be representative of the pattern, so the
corpus doesn't depend on any specific model's current output style and can't leak a real
third-party page's content. Same genre spread as the human side, so the comparison holds genre
roughly constant.

| File | Genre | Words (approx) |
|---|---|---|
| `api-reference.md` | API reference docs | 520 |
| `project-readme.md` | Open-source project README | 510 |
| `cli-help.md` | CLI usage guide | 440 |
| `engineering-notes.md` | Technical blog / postmortem style | 560 |
| `changelog.md` | Release notes | 400 |
| `howto-guide.md` | Task-oriented how-to | 470 |

## Fetched cache

`corpus/.cache/` (gitignored) is where a future `--fetch` pass for `corpus/SOURCES.md` URLs would
land pages. Empty for now since no URLs are listed above yet.
