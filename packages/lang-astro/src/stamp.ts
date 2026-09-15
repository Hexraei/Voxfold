/**
 * Dev-only stamp transform: inject `data-vf="<id>"` on every element that anchors a prose block,
 * so the browser overlay can find its way from rendered DOM text back to the exact file and node
 * that produced it. Same approach as `@voxfold/lang-vue`/`@voxfold/lang-svelte`'s `stamp.ts`.
 *
 * Insertion uses `magic-string` over the ORIGINAL source text with UTF-16 offsets (converted from
 * the compiler's byte offsets via `ByteOffsetMap` before this function ever sees them) — splicing
 * one attribute into the exact source position preserves everything else byte-for-byte and
 * produces an accurate source map from a simple diff instead of a full AST-to-string pass.
 *
 * Reuses `collectBlocks` from `index.ts` — the exact same function `extract()` uses — so the two
 * can never disagree about what counts as a block.
 */

import { createHash } from 'node:crypto'
import type { StampContext, StampEntry, StampResult } from '@voxfold/core'
import MagicString from 'magic-string'
import { ByteOffsetMap } from './byte-offsets.ts'
import type { CollectedBlock, WalkState } from './index.ts'
import { collectBlocks, parseAstroFileSync } from './index.ts'

const STAMP_ID_LENGTH = 8

function stampId(relativePath: string, nodePath: string): string {
  return createHash('sha1')
    .update(`${relativePath}:${nodePath}`)
    .digest('hex')
    .slice(0, STAMP_ID_LENGTH)
}

/** Right after the tag name, before any attributes — works whether the tag has 0 or N already. */
function insertionPointFor(element: CollectedBlock['element'], bytes: ByteOffsetMap): number {
  const start = bytes.toUtf16(element.position?.start.offset ?? 0)
  return start + 1 + element.name.length
}

export function stamp(text: string, context: StampContext): StampResult {
  const root = parseAstroFileSync(text)
  const bytes = new ByteOffsetMap(text)

  const state: WalkState = {
    source: text,
    counter: 0,
    uri: context.uri,
    settings: {},
    root,
    bytes,
  }
  const collected = collectBlocks(root, state)

  const magic = new MagicString(text)
  const entries: StampEntry[] = []

  for (const { element, elementPath, block } of collected) {
    // Only editable TEXT segments are refs the overlay may edit — a placeholder segment (an
    // `{expr}`, a locked `set:html`) also carries a `node`, but stamping it as a ref would offer
    // to edit something deliberately locked at extract time.
    const refs = block.segments
      .filter((segment) => segment.kind === 'text' && segment.editable && segment.node)
      .map((segment) => segment.node!)
    if (refs.length === 0) continue

    const id = stampId(context.relativePath, elementPath)
    magic.appendLeft(insertionPointFor(element, bytes), ` data-vf="${id}"`)

    entries.push({
      id,
      relativePath: context.relativePath,
      format: 'astro',
      nodePath: elementPath,
      refs,
    })
  }

  return {
    code: magic.toString(),
    entries,
    map: magic.generateMap({ hires: true, source: context.relativePath }),
  }
}
