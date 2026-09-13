/**
 * The contract every language adapter implements.
 *
 * An adapter's whole job is: walk a tree, decide what is prose, flatten it through BlockBuilder,
 * and keep the offsets honest. Markdown, HTML, JSX, Vue, Svelte and Astro all reduce to that, so
 * the engine, the CLI, the overlay and the writer never learn anything format-specific.
 */

import type { Format, NodeRef, Offset, ProseDocument } from './types.ts'

export interface ExtractContext {
  /** File path or URL this text came from, used for reporting and as the block id prefix. */
  uri: string
  /** Adapter-specific settings from user config (prose prop names, skip selectors…). */
  settings?: Record<string, unknown>
}

export interface StampContext {
  uri: string
  /** Project-root-relative path, used to derive stable stamp ids. */
  relativePath: string
}

/** One element stamped with a `data-vf` id, recorded in the dev server's registry. */
export interface StampEntry {
  id: string
  relativePath: string
  format: Format
  /** Structural path of the stamped element, stable across unrelated edits to the file. */
  nodePath: string
  /** Text nodes and prose literals inside this element that the overlay may edit. */
  refs: NodeRef[]
}

export interface StampResult {
  code: string
  entries: StampEntry[]
  /** Source map JSON, so stack traces still point at the author's original lines. */
  map?: unknown
}

/** A located node ready to patch: the exact span of its *value*, never its delimiters. */
export interface LocatedNode {
  valueRange: { start: Offset; end: Offset }
  /** The node's decoded text, as the reader sees it. */
  decoded: string
  /** Source offset per decoded character (entities, escapes, collapsed whitespace). */
  charMap?: Int32Array
  nodeType: string
}

/**
 * Write-side hooks. Kept deliberately small: the verify-then-write protocol lives in
 * `@voxfold/writer` and is identical for every format, so an adapter cannot invent its own,
 * less careful way of editing a file.
 */
export interface AdapterWriter<Ast = unknown> {
  /** Parse, or throw. A file that does not parse is never written to. */
  parse(text: string): Ast
  /** Find the node a ref points at, asserting its type. */
  locate(ast: Ast, ref: NodeRef): LocatedNode
  /** Escape replacement text for this node's context (JSX braces, markdown stars, entities). */
  encode(newDecoded: string, located: LocatedNode): string
  /**
   * Structure hash ignoring positions, with the target nodes' values masked. Comparing it
   * before and after a patch proves nothing but the intended text changed.
   */
  fingerprint(ast: Ast, maskedRefs: readonly NodeRef[]): string
}

export interface LanguageAdapter<Ast = unknown> {
  id: Format
  extensions: readonly string[]
  extract(text: string, context: ExtractContext): ProseDocument | Promise<ProseDocument>
  stamp?(text: string, context: StampContext): StampResult
  writer?: AdapterWriter<Ast>
}
