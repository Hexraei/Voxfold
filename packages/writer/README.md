# @voxfold/writer

Verify-then-write protocol for editing prose in place. Voxfold's overlay uses it
to write a live-page edit back into the real source file, safely:

- git guard: refuses to touch a file with unrelated uncommitted changes
- hash check: the file must still be what the editor saw
- minimal patch: only the edited sentence changes
- re-parse verification: the written file must produce the intended prose
- atomic write, with an undo history (`undoLast`)

```ts
import { applyEditRequest } from '@voxfold/writer'

const result = await applyEditRequest(request, { cwd: process.cwd() })
```

Part of [Voxfold](https://github.com/Hexraei/Voxfold). MIT.
