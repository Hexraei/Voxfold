# Rules

Generated from `packages/rules-recommended/rules/*.yaml`. Rule set `recommended@1.1.0`, 60 rules.

Weight is the score cost per occurrence. Every occurrence is flagged; where a density
threshold is set, occurrences below it cost a fraction of the weight instead of the whole.

**Auto-fix** rules have exactly one correct result and are applied by `--fix`.
**Suggests** offers choices a human picks. **Flag only** means the tool names the pattern and
you write the replacement — that is the whole point of the linter.

## Buzzwords

| Rule | Weight | Density | Fix | Flags |
|---|---|---|---|---|
| `ai-lexicon` | 4 | — | flag only | A rich tapestry of integrations. |
| `delve` | 4 | — | flag only | Let's delve into the details. |
| `cutting-edge` | 3 | — | flag only | Built on cutting-edge infrastructure. |
| `embark-journey` | 3 | — | flag only | Embark on your automation journey today. |
| `empower` | 3 | — | flag only | We empower developers to move faster. |
| `game-changer` | 3 | — | flag only | This is a game-changer for small teams. |
| `meticulously` | 3 | — | flag only | Meticulously crafted components. |
| `next-level` | 3 | — | flag only | Take your workflow to the next level. |
| `revolutionize` | 3 | — | flag only | We revolutionize how teams ship software. |
| `supercharge` | 3 | — | flag only | Supercharge your build pipeline. |
| `unlock-unleash` | 3 | — | flag only | Unlock your team's potential today. |
| `world-class` | 3 | — | flag only | World-class support, around the clock. |
| `bespoke-curated` | 2 | — | flag only | A curated selection of bespoke templates. |
| `elevate` | 2 | — | flag only | Elevate your content strategy. |
| `holistic` | 2 | — | flag only | A holistic approach to observability. |
| `pivotal-crucial` | 2 | — | flag only | Caching plays a pivotal role in performance. |
| `streamline` | 2 | — | flag only | It streamlines your entire workflow. |

## Structural constructions

| Rule | Weight | Density | Fix | Flags |
|---|---|---|---|---|
| `not-just-x-its-y` | 6 | — | flag only | It's not just a tool, it's a workflow. |
| `no-x-no-y-just-z` | 5 | — | flag only | No setup. No config. Just code. |
| `tricolon` | 5 | — | flag only | Fast. Simple. Secure. |
| `parallel-pair` | 4 | — | flag only | Built for speed. Designed for teams. |
| `rhetorical-question` | 4 | — | flag only | The best part? There isn't one. |
| `x-meets-y` | 4 | — | flag only | Where design meets engineering. |
| `dense-paragraph` | 3 | — | flag only | The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. |
| `from-x-to-y` | 3 | — | flag only | From startups to enterprises, teams rely on it. |
| `not-x-contrast` | 3 | 5+ per document | flag only | It is a smoke test, not a benchmark. |
| `scope-disclaimer` | 3 | 4+ per document | flag only | No speed advantage over the reference solver is claimed. |

## Adverbs on things

| Rule | Weight | Density | Fix | Flags |
|---|---|---|---|---|
| `adverb-inanimate-subject` | 5 | — | flag only | The dashboard quietly syncs your data. |

## Intensifiers

| Rule | Weight | Density | Fix | Flags |
|---|---|---|---|---|
| `effortlessly` | 4 | — | auto-fix (delete) | Deploy effortlessly from any branch. |
| `seamlessly` | 4 | — | auto-fix (delete) | It integrates seamlessly with your stack. |
| `robust` | 3 | — | flag only | A robust platform for growing teams. |
| `genuinely` | 2 | — | auto-fix (delete) | We genuinely care about your data. |
| `incredibly` | 2 | — | auto-fix (delete) | It is incredibly fast under load. |
| `truly` | 2 | — | auto-fix (delete) | This is truly the fastest option. |
| `simply` | 1 | — | flag only | Simply connect your repository and go. |

## Markdown-specific

| Rule | Weight | Density | Fix | Flags |
|---|---|---|---|---|
| `emoji-heading` | 3 | 3+ per document | flag only | 🚀 Features |
| `bold-lead-in-list` | 2 | 4+ per document | flag only | **Fast:** ships in milliseconds |
| `bold-overuse` | 2 | 6+ per document | flag only | **One** and **two** and **three**. |

## Openers and closers

| Rule | Weight | Density | Fix | Flags |
|---|---|---|---|---|
| `fast-paced-world` | 8 | — | auto-fix (delete) | In today's fast-paced world, teams need better tools. |
| `ever-evolving` | 6 | — | auto-fix (delete) | In the ever-evolving landscape of security, patching matters. |
| `look-no-further` | 5 | — | flag only | Need a faster linter? Look no further. |
| `whether-youre` | 5 | — | flag only | Whether you're a solo developer or a large team, it fits. |
| `dive-in` | 4 | — | auto-fix (delete) | Without further ado, here is the config. |
| `imagine-opener` | 4 | — | flag only | Imagine a world where builds never break. |
| `say-goodbye-to` | 4 | — | flag only | Say goodbye to flaky tests. |
| `at-the-end-of-the-day` | 3 | — | flag only | At the end of the day, shipping is what counts. |
| `heres-the-thing` | 3 | — | flag only | Here's the thing, most linters are slow. |
| `worth-noting` | 3 | — | auto-fix (delete) | It's worth noting that the API is rate limited. |

## Plain-word swaps

| Rule | Weight | Density | Fix | Flags |
|---|---|---|---|---|
| `leverage-verb` | 3 | — | auto-fix (replace) | We leverage caching to stay fast. |
| `plethora` | 3 | — | auto-fix (replace) | It offers a plethora of options. |
| `utilize` | 3 | — | auto-fix (replace) | We utilize modern tooling. |
| `commence` | 2 | — | auto-fix (replace) | The migration will commence tonight. |
| `endeavor` | 2 | — | flag only | We endeavor to respond within a day. |
| `facilitate` | 2 | — | flag only | The platform facilitates collaboration. |
| `in-order-to` | 2 | — | auto-fix (replace) | Restart the server in order to apply changes. |
| `myriad-of` | 2 | — | auto-fix (replace) | A myriad of integrations ship today. |

## Punctuation

| Rule | Weight | Density | Fix | Flags |
|---|---|---|---|---|
| `colon-reveal` | 3 | — | flag only | The result: teams ship twice as often. |
| `em-dash` | 3 | 3+ per block | auto-fix (replace) | It ships fast—really fast—and it scales—quietly. |
| `double-hyphen-dash` | 2 | — | suggests: comma / full stop | It ships fast -- really fast. |
| `exclamation-density` | 2 | 3+ per block | flag only | Ship faster! Build better! Scale further! |

## Details

### `adverb-inanimate-subject`

Manner adverb on a thing that cannot act — "The dashboard quietly syncs" gives feelings to software. Say what it does.

- kind: structural, weight: 5, fix: flag only

Flags:
- The dashboard quietly syncs your data.
- The parser gracefully handles errors.

Passes:
- She quietly left the room.
- Our team gently reminds customers before renewal.

### `ai-lexicon`

Overused abstract noun (tapestry, testament, realm, landscape) — These abstractions appear constantly in generated prose. Name the concrete thing.

- kind: structural, weight: 4, fix: flag only

Flags:
- A rich tapestry of integrations.
- In the ever-changing landscape of DevOps.

Passes:
- It connects to 40 services.

### `at-the-end-of-the-day`

"at the end of the day" — A filler transition. Delete it or state the conclusion.

- kind: structural, weight: 3, fix: flag only

Flags:
- At the end of the day, shipping is what counts.

Passes:
- Shipping is what counts.

### `bespoke-curated`

Bespoke / curated — Use "custom", or say who chose it and why.

- kind: structural, weight: 2, fix: flag only

Flags:
- A curated selection of bespoke templates.

Passes:
- Twelve templates, chosen by our design team.

### `bold-lead-in-list`

Bold lead-in on a list item — A page of "**Fast:** …" bullets reads as generated. One or two are fine.

- kind: structural, weight: 2, fix: flag only
- only in: markdown, mdx
- only on: listItem

Flags:
- **Fast:** ships in milliseconds

Passes:
- Run the CLI once to create a config file.
- WOOD1P: iteration limit

### `bold-overuse`

Several bold spans in one block — Bold works when it is rare. Three or more in one paragraph or row leaves nothing standing out.

- kind: structural, weight: 2, fix: flag only
- only in: markdown, mdx
- skipped in: heading

Flags:
- **One** and **two** and **three**.

Passes:
- One **bold** word.

### `colon-reveal`

Dramatic colon reveal — "The result:" builds suspense for a fact. State the fact.

- kind: structural, weight: 3, fix: flag only

Flags:
- The result: teams ship twice as often.

Passes:
- Result codes: 0 means success.

### `commence`

"commence" instead of "start" — Use "start" or "begin".

- kind: mechanical, weight: 2, fix: auto-fix (replace)

Flags:
- The migration will commence tonight.

Passes:
- The migration starts tonight.

### `cutting-edge`

Cutting-edge / state-of-the-art — Name the technology and the year instead.

- kind: structural, weight: 3, fix: flag only

Flags:
- Built on cutting-edge infrastructure.

Passes:
- Built on Postgres 17 and Redis.

### `delve`

"delve" — Use "look at" or "cover".

- kind: structural, weight: 4, fix: flag only

Flags:
- Let's delve into the details.

Passes:
- Here are the details.

### `dense-paragraph`

Paragraph too long to skim — Over about 110 words in one block. Split it, or turn the list inside it into a list.

- kind: structural, weight: 3, fix: flag only
- only on: paragraph, blockquote, listItem

Flags:
- The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case. The solver reads the model and runs the method for each case.

Passes:
- Short.

### `dive-in`

"let's dive in" / "without further ado" — Filler before the actual content. Delete it.

- kind: mechanical, weight: 4, fix: auto-fix (delete)

Flags:
- Without further ado, here is the config.

Passes:
- Here is the config.

### `double-hyphen-dash`

Double hyphen used as a dash — Write a real em dash, or restructure the sentence.

- kind: mechanical, weight: 2, fix: suggests: comma / full stop

Flags:
- It ships fast -- really fast.

Passes:
- Run the command with --verbose to see more.

### `effortlessly`

"effortlessly" — Delete it, or show the effort it saves.

- kind: mechanical, weight: 4, fix: auto-fix (delete)

Flags:
- Deploy effortlessly from any branch.

Passes:
- Deploy from any branch in one command.

### `elevate`

"elevate" — Use "improve", or name the change.

- kind: structural, weight: 2, fix: flag only

Flags:
- Elevate your content strategy.

Passes:
- Elevation data comes from the sensor.

### `em-dash`

Em dash — Em dashes cluster in generated copy. A comma, colon or full stop is usually clearer.

- kind: mechanical, weight: 3, fix: auto-fix (replace)

Flags:
- It ships fast—really fast—and it scales—quietly.

Passes:
- It ships fast and scales well.
- A hyphen-joined word is fine.

### `embark-journey`

Embark / journey — Using software is not a journey. Say what the first step is.

- kind: structural, weight: 3, fix: flag only

Flags:
- Embark on your automation journey today.

Passes:
- Install the CLI to get started.

### `emoji-heading`

Decorative emoji opening a heading — "🚀 Features" is the generated-README look. The heading text alone is enough.

- kind: structural, weight: 3, fix: flag only
- only in: markdown, mdx
- only on: heading

Flags:
- 🚀 Features
- ✨ Getting Started

Passes:
- Features

### `empower`

"empower" — Say what the reader can do that they could not before.

- kind: structural, weight: 3, fix: flag only

Flags:
- We empower developers to move faster.

Passes:
- Developers can deploy without filing a ticket.

### `endeavor`

"endeavor" — Use "try", or name the work.

- kind: structural, weight: 2, fix: flag only

Flags:
- We endeavor to respond within a day.

Passes:
- We reply within a day.

### `ever-evolving`

"ever-evolving" / "ever-changing" — Every field evolves. Delete the phrase.

- kind: mechanical, weight: 6, fix: auto-fix (delete)

Flags:
- In the ever-evolving landscape of security, patching matters.

Passes:
- Security patches ship every Tuesday.

### `exclamation-density`

Exclamation marks — Enthusiasm stacked on every sentence reads as generated. Keep at most one.

- kind: structural, weight: 2, fix: flag only

Flags:
- Ship faster! Build better! Scale further!

Passes:
- Ship faster. It really works.

### `facilitate`

"facilitate" — Say what actually happens: help, run, host, or simply do.

- kind: structural, weight: 2, fix: flag only

Flags:
- The platform facilitates collaboration.

Passes:
- The platform lets two people edit at once.

### `fast-paced-world`

"In today's fast-paced world" — The most recognizable generated opener there is. Start with the reader's problem.

- kind: mechanical, weight: 8, fix: auto-fix (delete)

Flags:
- In today's fast-paced world, teams need better tools.

Passes:
- Teams waste an hour a day on manual releases.

### `from-x-to-y`

"from X to Y" range formula — Naming both ends of a spectrum is a way of saying "everyone". Name your actual user.

- kind: structural, weight: 3, fix: flag only

Flags:
- From startups to enterprises, teams rely on it.

Passes:
- Migrate from Postgres to MySQL in one command.

### `game-changer`

Game-changer — Describe what changes for the reader.

- kind: structural, weight: 3, fix: flag only

Flags:
- This is a game-changer for small teams.

Passes:
- Small teams cut review time in half.

### `genuinely`

"genuinely" — Claiming sincerity rarely conveys it.

- kind: mechanical, weight: 2, fix: auto-fix (delete)

Flags:
- We genuinely care about your data.

Passes:
- We delete your data within 30 days.

### `heres-the-thing`

"here's the thing" — Conversational filler. Say the thing.

- kind: structural, weight: 3, fix: flag only

Flags:
- Here's the thing, most linters are slow.

Passes:
- Most linters take 30 seconds on this repo.

### `holistic`

"holistic" — Say which parts are covered.

- kind: structural, weight: 2, fix: flag only

Flags:
- A holistic approach to observability.

Passes:
- Logs, metrics and traces in one place.

### `imagine-opener`

"Imagine…" opener — Asking the reader to imagine a scenario is a generated-essay habit. Show the real thing.

- kind: structural, weight: 4, fix: flag only

Flags:
- Imagine a world where builds never break.

Passes:
- Builds have not broken in 90 days.

### `in-order-to`

"in order to" — "to" says the same thing.

- kind: mechanical, weight: 2, fix: auto-fix (replace)

Flags:
- Restart the server in order to apply changes.

Passes:
- Restart the server to apply changes.

### `incredibly`

"incredibly" — Replace the intensifier with a number.

- kind: mechanical, weight: 2, fix: auto-fix (delete)

Flags:
- It is incredibly fast under load.

Passes:
- It answers in 40ms under load.

### `leverage-verb`

"leverage" as a verb — Use "use". Keep "leverage" for the financial noun.

- kind: mechanical, weight: 3, fix: auto-fix (replace)

Flags:
- We leverage caching to stay fast.

Passes:
- The fund reduced its leverage.

### `look-no-further`

"look no further" — Advertising copy. Say what the thing does.

- kind: structural, weight: 5, fix: flag only

Flags:
- Need a faster linter? Look no further.

Passes:
- This linter checks 1,000 files a second.

### `meticulously`

Meticulous / meticulously — Show the care rather than asserting it.

- kind: structural, weight: 3, fix: flag only

Flags:
- Meticulously crafted components.

Passes:
- Every component ships with tests.

### `myriad-of`

"a myriad of" — Use "many", or give the number.

- kind: mechanical, weight: 2, fix: auto-fix (replace)

Flags:
- A myriad of integrations ship today.

Passes:
- Many integrations ship today.

### `next-level`

Next-level / take it to the next level — Say which level, or drop the phrase.

- kind: structural, weight: 3, fix: flag only

Flags:
- Take your workflow to the next level.

Passes:
- Cut your release checklist to three steps.

### `no-x-no-y-just-z`

"No X. No Y. Just Z." construction — The negation-then-payoff rhythm reads as an advertisement.

- kind: structural, weight: 5, fix: flag only

Flags:
- No setup. No config. Just code.

Passes:
- No configuration is required for small projects.

### `not-just-x-its-y`

"not just X, it's Y" construction — Say what it is. Defining by contrast with what it is not is the signature AI cadence.

- kind: structural, weight: 6, fix: flag only

Flags:
- It's not just a tool, it's a workflow.
- This isn't just about speed, it's about confidence.
- Our platform doesn't just manage tasks, it's a workflow.

Passes:
- This is not just for admins; editors can use it too.
- It is more than we expected.
- It doesn't just work on Linux; we test on Windows as well.

### `not-x-contrast`

"X, not Y" contrast — Defining a thing by what it is not, again and again, is a generated rhythm. State what it is.

- kind: structural, weight: 3, fix: flag only
- only on: paragraph, listItem, blockquote, tableCell

Flags:
- It is a smoke test, not a benchmark.

Passes:
- It is a smoke test.

### `parallel-pair`

Parallel participle pair ("Built for X. Designed for Y.") — Matched sentence openings are a rhythm device. One plain sentence usually carries more.

- kind: structural, weight: 4, fix: flag only

Flags:
- Built for speed. Designed for teams.

Passes:
- Built for speed, it answers in 40ms and runs on one core.

### `pivotal-crucial`

Pivotal / crucial / vital — If it matters, the reason will show it.

- kind: structural, weight: 2, fix: flag only

Flags:
- Caching plays a pivotal role in performance.

Passes:
- Caching cuts page loads from 800ms to 90ms.

### `plethora`

"a plethora of" — Use "many", or give the number.

- kind: mechanical, weight: 3, fix: auto-fix (replace)

Flags:
- It offers a plethora of options.

Passes:
- It offers many options.

### `revolutionize`

"revolutionize" — Almost nothing revolutionizes an industry. Describe the actual change.

- kind: structural, weight: 3, fix: flag only

Flags:
- We revolutionize how teams ship software.

Passes:
- Teams ship without a release manager.

### `rhetorical-question`

Rhetorical question answered immediately — Asking a question to answer it yourself pads the copy. State the answer.

- kind: structural, weight: 4, fix: flag only

Flags:
- The best part? There isn't one.
- Why does it matter? Because speed compounds.

Passes:
- How do I install it? Run npm install voxfold, then add a config file and run it once.

### `robust`

"robust" — Say what makes it robust: retries, tests, uptime.

- kind: structural, weight: 3, fix: flag only

Flags:
- A robust platform for growing teams.

Passes:
- It retries failed jobs three times.
- Robustness testing runs every night.

### `say-goodbye-to`

"say goodbye to" — Name what replaces it instead.

- kind: structural, weight: 4, fix: flag only

Flags:
- Say goodbye to flaky tests.

Passes:
- Retries removed 90% of flaky failures.

### `scope-disclaimer`

Scope disclaimer sentence — Sentences that say what the work does not claim read as boilerplate when they repeat. Keep one, put the limit next to the number it limits, and cut the rest.

- kind: structural, weight: 3, fix: flag only
- only on: paragraph, listItem, blockquote, tableCell

Flags:
- No speed advantage over the reference solver is claimed.

Passes:
- The solver passed 90 of 93 cases.

### `seamlessly`

"seamlessly" — Everything claims to be seamless. Delete it, or say what the integration actually does.

- kind: mechanical, weight: 4, fix: auto-fix (delete)

Flags:
- It integrates seamlessly with your stack.
- A seamless experience across devices.

Passes:
- It integrates with GitHub and GitLab.

### `simply`

"simply" — If it is simple, the steps will show it. Telling the reader it is easy can read as dismissive.

- kind: structural, weight: 1, fix: flag only

Flags:
- Simply connect your repository and go.

Passes:
- Connect your repository, then pick a branch.

### `streamline`

"streamline" — Name the step that disappears.

- kind: structural, weight: 2, fix: flag only

Flags:
- It streamlines your entire workflow.

Passes:
- It removes the manual approval step.

### `supercharge`

Supercharge / turbocharge — Give the speed-up as a number.

- kind: structural, weight: 3, fix: flag only

Flags:
- Supercharge your build pipeline.

Passes:
- Builds finish 3x faster.

### `tricolon`

Three-part fragment rhythm ("Fast. Simple. Secure.") — Three one-word sentences in a row is a rhetorical flourish, not information.

- kind: structural, weight: 5, fix: flag only
- skipped in: listItem

Flags:
- Fast. Simple. Secure.
- Plan. Build. Ship.

Passes:
- Install the CLI. Add a config file. Run the linter.

### `truly`

"truly" — The sentence is as true without it.

- kind: mechanical, weight: 2, fix: auto-fix (delete)

Flags:
- This is truly the fastest option.

Passes:
- This is the fastest option we measured.

### `unlock-unleash`

Unlock / unleash — Nothing was locked. Say what the reader can now do.

- kind: structural, weight: 3, fix: flag only

Flags:
- Unlock your team's potential today.
- Unleash the power of your data.

Passes:
- Unlock the door with your badge.
- Unlock your account from the settings page.

### `utilize`

"utilize" instead of "use" — Use "use". It is shorter and means the same thing.

- kind: mechanical, weight: 3, fix: auto-fix (replace)

Flags:
- We utilize modern tooling.
- The team utilized every option.

Passes:
- We use modern tooling.

### `whether-youre`

"whether you're X or Y" — A formula for addressing everyone at once. Write to one reader.

- kind: structural, weight: 5, fix: flag only

Flags:
- Whether you're a solo developer or a large team, it fits.

Passes:
- It works for teams of up to 50 people.

### `world-class`

World-class / best-in-class — Compared with what? Give the benchmark or drop the claim.

- kind: structural, weight: 3, fix: flag only

Flags:
- World-class support, around the clock.

Passes:
- Support replies within four hours.

### `worth-noting`

"it's worth noting that" — Note it. The preamble adds nothing.

- kind: mechanical, weight: 3, fix: auto-fix (delete)

Flags:
- It's worth noting that the API is rate limited.

Passes:
- The API allows 100 requests a minute.

### `x-meets-y`

"X meets Y" formula — A slogan shape. Describe the combination plainly.

- kind: structural, weight: 4, fix: flag only

Flags:
- Where design meets engineering.

Passes:
- The team meets every Tuesday.

