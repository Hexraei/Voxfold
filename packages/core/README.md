# @voxfold/core

Deterministic style-tell engine for Voxfold: text + offset map in, flags + style
score out. This is the package every adapter, integration, and the CLI builds on.

```ts
import { lint } from '@voxfold/core'
import recommended from '@voxfold/rules-recommended'

const result = lint('Seamlessly robust. Not just fast, it is easy.', {
  rules: recommended,
})
// result.flags -> [{ rule, message, range, fix? }, ...]
// result.score -> 0..100
```

- No AI, no network: every rule is a named, inspectable detector.
- Offsets stay honest: flags point back into the original source through an
  explicit offset map, so edits land on the real bytes.
- Fixes are fixed substitutions only; rewriting prose is left to the author.

Part of [Voxfold](https://github.com/Hexraei/Voxfold). MIT.
