/**
 * Dev-only stamp transform: inject `data-vf="<id>"` on every host element that anchors a prose
 * block, so the browser overlay can find its way from a piece of rendered DOM text back to the
 * exact file and node that produced it.
 *
 * Insertion uses `magic-string` rather than re-printing the file through Babel's generator:
 * splicing one attribute into the exact source position preserves everything else byte-for-byte
 * (comments, formatting, even syntax the parser round-trips lossily) and produces an accurate
 * source map from a simple diff instead of a full AST-to-string pass.
 *
 * Reuses `collectBlocks` from `index.ts` — the exact same function `extract()` uses — rather than
 * re-deriving "what counts as a block" here. Any drift between the two would mean the overlay
 * either can't find a ref extract() considers editable, or offers to edit one that isn't really
 * a block at all.
 */

import { createHash } from 'node:crypto'
import type { JSXElement } from '@babel/types'
import type { StampContext, StampEntry, StampResult } from '@voxfold/core'
import MagicString from 'magic-string'
import { collectBlocks, parseJsx } from './index.ts'

const STAMP_ID_LENGTH = 8

function stampId(relativePath: string, nodePath: string): string {
  return createHash('sha1')
    .update(`${relativePath}:${nodePath}`)
    .digest('hex')
    .slice(0, STAMP_ID_LENGTH)
}

/** Right after the tag name, before any attributes — works whether the tag has 0 or N already. */
function insertionPointFor(element: JSXElement): number {
  return element.openingElement.name.end!
}

export function stamp(text: string, context: StampContext): StampResult {
  const ast = parseJsx(text)
  const root = ast.program as unknown as import('@babel/types').Node

  const collected = collectBlocks(root, {
    source: text,
    counter: 0,
    uri: context.uri,
    settings: {},
    root,
  })

  const magic = new MagicString(text)
  const entries: StampEntry[] = []

  for (const { element, elementPath, block } of collected) {
    // Only editable TEXT segments are refs the overlay may edit — a placeholder segment (an
    // `{expr}`, a locked inline element) also carries a `node`, but stamping it as a ref would
    // offer to edit something that was deliberately locked at extract time.
    const refs = block.segments
      .filter((segment) => segment.kind === 'text' && segment.editable && segment.node)
      .map((segment) => segment.node!)
    if (refs.length === 0) continue

    const id = stampId(context.relativePath, elementPath)
    magic.appendLeft(insertionPointFor(element), ` data-vf="${id}"`)

    entries.push({
      id,
      relativePath: context.relativePath,
      format: 'jsx',
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
