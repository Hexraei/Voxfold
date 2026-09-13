/**
 * BlockBuilder: the one way adapters turn a block's inline children into a flat string.
 *
 *   <p>Our platform <strong>doesn't just</strong> manage tasks</p>
 *
 * arrives as three separate nodes. Naive per-node matching misses "not just X, it's Y"
 * entirely, so every adapter flattens through this builder and gets an OffsetMap back.
 */

import { OffsetMap } from './offset-map.ts'
import {
  type Block,
  type BlockContext,
  type BlockKind,
  type LockReason,
  type NodeRef,
  type Offset,
  PLACEHOLDER_CHAR,
  type Segment,
} from './types.ts'

export interface TextOptions {
  /**
   * Source offset for each decoded character. Required whenever the mapping is non-linear:
   * entities (`&mdash;` → one char), markdown escapes (`\*` → one char), collapsed whitespace.
   * Length must equal the decoded text length.
   */
  charMap?: Int32Array | number[]
  node?: NodeRef
  /** Defaults to true: plain text in a source file is editable unless the adapter says not. */
  editable?: boolean
  lockReason?: LockReason
}

export interface PlaceholderOptions {
  node?: NodeRef
  lockReason?: LockReason
}

export interface BuildOptions {
  id: string
  kind: BlockKind
  context?: Partial<BlockContext>
}

/** A block plus its offset map. Adapters keep the map; `Block` alone is what rules see. */
export interface BuiltBlock {
  block: Block
  map: OffsetMap
}

export class BlockBuilder {
  private text = ''
  private readonly segments: Segment[] = []

  /** Flat length so far, i.e. where the next segment starts. */
  get length(): Offset {
    return this.text.length
  }

  /** Nothing but inserted boundaries so far. */
  get isEmpty(): boolean {
    return this.segments.every((segment) => segment.kind === 'boundary')
  }

  /**
   * Append decoded text backed by `[srcStart, srcEnd)` in the source file.
   * `decoded` is what the reader sees; the source may be longer (entities, escapes).
   */
  addText(decoded: string, srcStart: Offset, srcEnd: Offset, options: TextOptions = {}): this {
    if (decoded.length === 0) return this

    const charMap = options.charMap
      ? options.charMap instanceof Int32Array
        ? options.charMap
        : Int32Array.from(options.charMap)
      : undefined

    if (charMap && charMap.length !== decoded.length) {
      throw new Error(
        `charMap length ${charMap.length} does not match decoded text length ${decoded.length}`,
      )
    }
    if (!charMap && srcEnd - srcStart !== decoded.length) {
      throw new Error(
        `text span ${srcEnd - srcStart} does not match decoded length ${decoded.length}; ` +
          'pass a charMap for non-linear mappings (entities, escapes, collapsed whitespace)',
      )
    }

    const flatStart = this.text.length
    this.text += decoded
    this.segments.push({
      kind: 'text',
      flatStart,
      flatEnd: this.text.length,
      src: { start: srcStart, end: srcEnd },
      ...(charMap ? { charMap } : {}),
      ...(options.node ? { node: options.node } : {}),
      editable: options.editable ?? true,
      ...(options.lockReason ? { lockReason: options.lockReason } : {}),
    })
    return this
  }

  /**
   * Append a stand-in for content that is not prose we can lint or edit: inline code,
   * `{expression}`, a nested component. It keeps the sentence shape intact ("Run ￼ to install")
   * without being matched or counted as a word, and is never editable.
   */
  addPlaceholder(srcStart: Offset, srcEnd: Offset, options: PlaceholderOptions = {}): this {
    const flatStart = this.text.length
    this.text += PLACEHOLDER_CHAR
    this.segments.push({
      kind: 'placeholder',
      flatStart,
      flatEnd: this.text.length,
      src: { start: srcStart, end: srcEnd },
      ...(options.node ? { node: options.node } : {}),
      editable: false,
      lockReason: options.lockReason ?? 'expression',
    })
    return this
  }

  /**
   * Append text that exists only in the flat string, with no source behind it: the space
   * implied by an element boundary in `<span>one</span><span>two</span>`. Never editable.
   */
  addBoundary(text = ' '): this {
    if (text.length === 0) return this
    // Collapse doubled boundaries so "a </b> b" does not gain a second space.
    if (this.text.length === 0 || /\s$/.test(this.text)) return this

    const flatStart = this.text.length
    this.text += text
    this.segments.push({
      kind: 'boundary',
      flatStart,
      flatEnd: this.text.length,
      editable: false,
    })
    return this
  }

  build(options: BuildOptions): BuiltBlock {
    const context: BlockContext = { weight: 1, ...options.context }
    const block: Block = {
      id: options.id,
      kind: options.kind,
      text: this.text,
      segments: this.segments,
      context,
    }
    return { block, map: new OffsetMap(this.segments) }
  }
}

/** Rebuild the offset map for a block that crossed a package or worker boundary. */
export function mapOf(block: Block): OffsetMap {
  return new OffsetMap(block.segments)
}
