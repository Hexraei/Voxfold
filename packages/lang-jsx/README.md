# @voxfold/lang-jsx

JSX/TSX adapter for Voxfold: walks @babel/parser and replicates React's own whitespace algorithm, so the prose it lints reads exactly like the rendered page.

A language adapter turns a source file into flattened prose plus an offset map,
which `@voxfold/core` then lints - so every flag points back to the exact bytes in
the original file.

You rarely use adapters directly: the `voxfold` CLI and the framework integrations
pick the right adapter per file. Depend on this package if you are building your
own tooling on the Voxfold engine.

Part of [Voxfold](https://github.com/Hexraei/Voxfold). MIT.
