# @voxfold/lang-html

HTML adapter for Voxfold: walks parse5 with location info and flattens visible prose, skipping scripts, styles, and other non-copy nodes.

A language adapter turns a source file into flattened prose plus an offset map,
which `@voxfold/core` then lints - so every flag points back to the exact bytes in
the original file.

You rarely use adapters directly: the `voxfold` CLI and the framework integrations
pick the right adapter per file. Depend on this package if you are building your
own tooling on the Voxfold engine.

Part of [Voxfold](https://github.com/Hexraei/Voxfold). MIT.
