/**
 * The recommended rule set, compiled from `rules/*.yaml` at build time.
 *
 * Data only: no matching logic lives here. The set's version is independent of the package
 * version, because a score printed as `recommended@1.0.0` must mean the same thing forever.
 */

import type { RuleSet } from '@voxfold/core'
import ruleset from './generated/ruleset.json' with { type: 'json' }

export const recommended = ruleset as unknown as RuleSet

export default recommended
