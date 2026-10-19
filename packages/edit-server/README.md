# @voxfold/edit-server

Transport-agnostic dev-server handlers for Voxfold's overlay. The Vite, Astro, and
Next integrations mount these over `/__voxfold/*`:

- stamp registry: maps each on-screen prose range back to its source span
- resolve: locate the exact sentence under a click
- plan / apply: turn an edit into a verified write via `@voxfold/writer`
- undo: revert the last applied edit
- suppress: persist "don't flag this here" decisions

You almost never depend on this package directly - install `@voxfold/vite`,
`@voxfold/astro`, or `@voxfold/next` instead.

Part of [Voxfold](https://github.com/Hexraei/Voxfold). MIT.
