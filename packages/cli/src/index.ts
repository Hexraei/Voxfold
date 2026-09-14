/**
 * Public entry for the `voxfold` package: `defineConfig` for config files, plus the pieces a
 * consumer might script against directly instead of shelling out to the CLI.
 */

export { run } from './cli.ts'
export {
  type ConfigEntry,
  defineConfig,
  type RuleConfigValue,
  type VoxfoldConfig,
} from './config.ts'
