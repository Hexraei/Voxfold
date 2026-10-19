# @voxfold/rules-recommended

The recommended Voxfold rule set: the AI-copy tells, as data. Em-dash clusters,
"not just X, it's Y", tricolons ("Fast. Simple. Secure."), "seamlessly",
"robust", and friends - each rule is named, documented, and inspectable.

```ts
import { lint } from '@voxfold/core'
import recommended from '@voxfold/rules-recommended'

const { flags, score } = lint(text, { rules: recommended })
```

Rules ship as plain data with their detectors, so you can review exactly what
fires, subset the set, or extend it with your own tells.

Part of [Voxfold](https://github.com/Hexraei/Voxfold). MIT.
