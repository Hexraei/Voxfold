/**
 * @voxfold/core — the deterministic style-tell engine.
 *
 * Pure: no file I/O, no network, no UI, no AI. Text plus an offset map goes in, flags and a
 * style score come out, identically in Node, the browser overlay and CI.
 */

export type {
  AdapterWriter,
  ExtractContext,
  LanguageAdapter,
  LocatedNode,
  StampContext,
  StampEntry,
  StampResult,
} from './adapter.ts'
export {
  BlockBuilder,
  type BuildOptions,
  type BuiltBlock,
  mapOf,
  type PlaceholderOptions,
  type TextOptions,
} from './block-builder.ts'
export { type Bias, type MappedRange, OffsetMap } from './offset-map.ts'
export { equalsNormalized, normalizeForMatch } from './text/normalize.ts'
export { type Sentence, splitSentences } from './text/sentences.ts'
export {
  COMPROMISE_VERSION,
  CompromiseTagger,
  defaultTagger,
  type Tag,
  type TaggedToken,
  type Tagger,
} from './text/tagger.ts'
export { countWords, isWordToken, type Token, type TokenType, tokenize } from './text/tokenize.ts'
export {
  type Block,
  type BlockContext,
  type BlockKind,
  type Directive,
  type DirectiveType,
  type Format,
  type LockReason,
  type NodeRef,
  type Offset,
  PLACEHOLDER_CHAR,
  type ProseDocument,
  type Region,
  type Segment,
  type SegmentKind,
  type SourceRange,
} from './types.ts'
