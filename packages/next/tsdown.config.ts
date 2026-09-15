import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/overlay.ts', 'src/loader.ts', 'src/component.tsx'],
    format: 'esm',
    platform: 'node',
    dts: true,
    clean: true,
  },
  {
    // Separate build: the sidecar serves this bundle's output verbatim at GET /worker.js, loaded
    // into a browser Worker via a Blob URL that can't resolve bare `node_modules` specifiers — so
    // unlike the entry above, @voxfold/core and @voxfold/rules-recommended must be INLINED, not
    // left as external imports. See worker-entry.ts's module doc for the full reasoning.
    entry: { 'worker-bundle': 'src/worker-entry.ts' },
    format: 'esm',
    platform: 'browser',
    dts: false,
    clean: false,
    outExtensions: () => ({ js: '.mjs' }),
    // Exact package names don't match a subpath import like '@voxfold/overlay/worker' — a regex
    // (or the /^…$/ equivalent) is required to catch subpaths too (confirmed via `tsdown --debug`,
    // which otherwise logs `shouldExternal: '@voxfold/overlay/worker' = true` despite this array).
    deps: {
      alwaysBundle: [/^@voxfold\/(core|rules-recommended|overlay)(\/.*)?$/],
    },
  },
])
