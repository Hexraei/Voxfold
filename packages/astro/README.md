# @voxfold/astro

Astro integration for Voxfold: stamps `.astro`/`.md`/`.mdx` in dev, serves the
edit-server over `/__voxfold/*`, and injects the browser overlay.

```ts
// astro.config.mjs
import voxfold from '@voxfold/astro'
import { defineConfig } from 'astro/config'

export default defineConfig({
  integrations: [voxfold()],
})
```

In dev, AI-copy tells on the live page are highlighted; click a flag, edit the
sentence, and the change is written back to the source file. Nothing is added to
production builds.

Part of [Voxfold](https://github.com/Hexraei/Voxfold). MIT.
