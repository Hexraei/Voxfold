import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/worker.ts'],
  format: 'esm',
  platform: 'browser',
  dts: true,
  clean: true,
  // `.mjs`, not the `.js` default for `platform: 'browser'`: a consuming app's own
  // @vitejs/plugin-react (or Vue/Svelte equivalent) runs its Fast Refresh transform on any id
  // matching `/\.[tj]sx?$/` outside `node_modules` — which a `/@fs/`-served `dist/index.js`
  // matches, since a workspace package under `packages/` isn't inside `node_modules`. That
  // transform injects `$RefreshSig$` calls that corrupt Preact's unrelated hook state ("Cannot
  // read properties of undefined (reading '__H')"). `.mjs` never matches that regex — the same
  // reason Preact's own build ships `.mjs` files.
  fixedExtension: true,
  copy: [{ from: 'src/style.css', to: 'dist' }],
})
