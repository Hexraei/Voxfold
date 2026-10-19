# @voxfold/vite

Vite plugin for Voxfold: stamps JSX/TSX in dev, serves the edit-server over
`/__voxfold/*`, and injects the browser overlay.

```ts
// vite.config.ts
import voxfold from '@voxfold/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [voxfold()],
})
```

With the plugin active in dev, AI-copy tells on the live page are highlighted;
click a flag, edit the sentence, and the change is written back to the source
file. Nothing is added to production builds.

Part of [Voxfold](https://github.com/Hexraei/Voxfold). MIT.
