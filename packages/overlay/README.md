# @voxfold/overlay

Dev-only browser overlay: highlights AI-copy tells on the live page, and lets you
click a flag to edit the sentence in place - the edit is written straight back to
the real source file through Voxfold's edit-server and writer.

```ts
import { mountOverlay } from '@voxfold/overlay'
```

The overlay is injected for you by the framework integrations (`@voxfold/vite`,
`@voxfold/astro`, `@voxfold/next`) in dev mode only; it never ships to production.
Depend on it directly only if you are building a custom integration.

Part of [Voxfold](https://github.com/Hexraei/Voxfold). MIT.
