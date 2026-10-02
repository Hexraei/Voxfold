/**
 * Core contracts every language adapter targets.
 *
 * Offsets are ALWAYS UTF-16 code unit indices into the decoded source text (the same units
 * JavaScript string indices, Babel, remark and parse5 use). Adapters whose parser reports
 * UTF-8 byte offsets must convert before building blocks.
 */

/** UTF-16 code unit index into a decoded source text. */
export type Offset = number

/** A half-open range `[start, end)` of UTF-16 code units in one file. */
export interface SourceRange {
  start: Offset
  end: Offset
}

export type Format = 'markdown' | 'mdx' | 'html' | 'jsx' | 'vue' | 'svelte' | 'astro' | 'text'

/**
 * Why a stretch of prose cannot be edited in place. Shown verbatim-ish to the user as the
 * "this text comes from a variable, can't edit here" badge, so each value names a real cause.
 */
export type LockReason =
  | 'inline-tag'
  | 'expression'
  | 'variable'
  | 'map'
  | 'template-literal'
  | 'i18n'
  | 'import'
  | 'html-injection'
  | 'unknown'

/** Opaque, adapter-specific pointer to the AST node a segment came from. */
export interface NodeRef {
  /** Structural path within the file, e.g. `body.1.children.3`. Stable across unrelated edits. */
  path: string
  /** Parser node type, asserted again at write time (`JSXText`, `text`, `StringLiteral`, …). */
  type: string
}

export type SegmentKind = 'text' | 'placeholder' | 'boundary'

/**
 * One contiguous run of flattened text and where it came from.
 *
 * `charMap` is only present when the mapping is non-linear: HTML entities, markdown escapes,
 * collapsed whitespace. When absent, flat offset `flatStart + i` maps to `src.start + i`.
 */
export interface Segment {
  kind: SegmentKind
  flatStart: Offset
  flatEnd: Offset
  src?: SourceRange
  /** For each flat char in this segment, its source offset. Length === flatEnd - flatStart. */
  charMap?: Int32Array
  node?: NodeRef
  editable: boolean
  lockReason?: LockReason
}

export type BlockKind =
  | 'paragraph'
  | 'heading'
  | 'listItem'
  | 'blockquote'
  | 'tableCell'
  | 'caption'
  | 'label'
  | 'other'

export type Region = 'main' | 'nav' | 'footer' | 'legal'

export interface BlockContext {
  headingDepth?: number
  inList?: boolean
  region?: Region
  /** Score multiplier for tells found here. Footer/legal prose counts at 0.5. */
  weight: number
}

/** A block of prose flattened into one continuous string, plus the map back to source. */
export interface Block {
  id: string
  kind: BlockKind
  text: string
  segments: Segment[]
  context: BlockContext
  /**
   * Flat-text ranges `[start, end)` the author emphasised (bold or strong). Optional: adapters
   * that flatten emphasis away omit it, and rules that need it then find nothing.
   */
  emphasis?: Array<[number, number]>
}

export type DirectiveType = 'disable' | 'enable' | 'disable-next-line' | 'disable-line'

/**
 * An inline `voxfold-disable*` comment, parsed by the adapter and applied by the engine.
 * `rules` empty means "all rules".
 */
export interface Directive {
  type: DirectiveType
  rules: string[]
  src: SourceRange
  /** 1-based line the directive sits on, used by the line-scoped directive types. */
  line: number
}

export interface ProseDocument {
  uri: string
  format: Format
  /** Full decoded source text, when available. Adapters over a live DOM omit it. */
  source?: string
  blocks: Block[]
  directives: Directive[]
}

/** The Object Replacement Character: stands in for inline code, `{expr}`, and components. */
export const PLACEHOLDER_CHAR = '￼'
