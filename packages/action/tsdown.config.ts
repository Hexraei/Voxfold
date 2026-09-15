import { defineConfig } from 'tsdown'

// The Actions runtime execs dist/index.js directly with no npm install step, so every
// dependency (including workspace packages) must be inlined into one file.
export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  dts: false,
  clean: true,
  noExternal: [/.*/],
})
