import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/stamp.ts', 'src/vitepress.ts'],
  format: 'esm',
  platform: 'node',
  dts: true,
  clean: true,
})
