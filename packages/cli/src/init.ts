/**
 * `voxfold init`: detect the project's framework, write a starter `voxfold.config.ts`, and print
 * the one remaining manual step (installing and wiring the matching dev-integration package) —
 * deliberately NOT an automated edit to the user's own `vite.config.ts`/`next.config.ts`/astro
 * config. Those files are handwritten, framework-version-sensitive, and often already customized;
 * a wrong automated edit there is a much worse failure mode than asking the user to paste one
 * line themselves. `init` still goes through the same "read → decide → write" shape as everything
 * else in this project (detect, then write exactly one new file, print a diff-free confirmation),
 * just scoped to the one file it's safe to fully own.
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type DetectedFramework = 'vite' | 'next' | 'astro' | 'unknown'

interface PackageJsonShape {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function hasDep(pkg: PackageJsonShape, name: string): boolean {
  return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name])
}

export async function detectFramework(cwd: string): Promise<DetectedFramework> {
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return 'unknown'
  let pkg: PackageJsonShape
  try {
    pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as PackageJsonShape
  } catch {
    return 'unknown'
  }
  // Next and Astro are checked before Vite: a Next or Astro project's own dev server is built on
  // Vite internally for Astro (and neither ships a top-level `vite` dependency in the common
  // case), so checking Vite first would misclassify nothing here — but checking the more specific
  // framework first is the correct precedence regardless, since "astro" or "next" is always the
  // more useful answer than the generic "vite" when both could technically match.
  if (hasDep(pkg, 'next')) return 'next'
  if (hasDep(pkg, 'astro')) return 'astro'
  if (hasDep(pkg, 'vite')) return 'vite'
  return 'unknown'
}

const INTEGRATION_PACKAGE: Record<Exclude<DetectedFramework, 'unknown'>, string> = {
  vite: '@voxfold/vite',
  next: '@voxfold/next',
  astro: '@voxfold/astro',
}

const INTEGRATION_SNIPPET: Record<Exclude<DetectedFramework, 'unknown'>, string> = {
  vite: `import { voxfold } from '@voxfold/vite'

export default defineConfig({
  plugins: [
    // ...your existing plugins
    voxfold(),
  ],
})`,
  next: `import { withVoxfold } from '@voxfold/next'

export default withVoxfold({
  // ...your existing config
})`,
  astro: `import voxfold from '@voxfold/astro'

export default defineConfig({
  integrations: [
    // ...your existing integrations
    voxfold(),
  ],
})`,
}

const CONFIG_TEMPLATE = `import { defineConfig } from 'voxfold'

export default defineConfig([
  {
    // Lint everything by default. Narrow with \`files\`/\`ignores\` per entry if needed.
    rules: {
      // 'em-dash': 'off',
    },
  },
])
`

export interface InitResult {
  framework: DetectedFramework
  configPath: string
  configWritten: boolean
  integrationPackage: string | undefined
  integrationSnippet: string | undefined
}

export async function runInit(cwd: string): Promise<InitResult> {
  const framework = await detectFramework(cwd)
  const configPath = join(cwd, 'voxfold.config.ts')
  const configWritten = !existsSync(configPath)
  if (configWritten) {
    await writeFile(configPath, CONFIG_TEMPLATE)
  }
  return {
    framework,
    configPath,
    configWritten,
    integrationPackage: framework === 'unknown' ? undefined : INTEGRATION_PACKAGE[framework],
    integrationSnippet: framework === 'unknown' ? undefined : INTEGRATION_SNIPPET[framework],
  }
}
