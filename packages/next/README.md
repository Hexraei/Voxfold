# @voxfold/next

Next.js integration for Voxfold: a webpack + Turbopack stamp loader, a sidecar
edit-server, overlay injection, and RSC-aware editing.

```ts
// next.config.ts
import withVoxfold from '@voxfold/next'

export default withVoxfold({
  // your Next config
})
```

In dev, AI-copy tells on the live page are highlighted; click a flag, edit the
sentence, and the change is written back to the source file. Nothing is added to
production builds.

Part of [Voxfold](https://github.com/Hexraei/Voxfold). MIT.
