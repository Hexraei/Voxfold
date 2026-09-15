/**
 * Dev-only stamp transform: inject `data-vf="<id>"` on every element that anchors a prose block,
 * so the browser overlay can find its way from rendered DOM text back to the exact file and node
 * that produced it. Same approach as `@voxfold/lang-jsx`'s `stamp.ts`.
 *
 * Insertion uses `magic-string` rather than re-printing the template through compiler-sfc's own
 * codegen: splicing one attribute into the exact source position preserves everything else
 * byte-for-byte (script, style, formatting) and produces an accurate source map from a simple
 * diff instead of a full AST-to-string pass.
 *
 * Reuses `collectBlocks` from `index.ts` — the exact same function `extract()` uses — so the two
 * can never disagree about what counts as a block.
 */

import { createHash } from 'node:crypto'
import type { StampContext, StampEntry, StampResult } from '@voxfold/core'
import type { ElementNode } from '@vue/compiler-core'
import MagicString from 'magic-string'
import { collectBlocks, parseVueSfc } from './index.ts'

const STAMP_ID_LENGTH = 8

function stampId(relativePath: string, nodePath: string): string {
  return createHash('sha1')
    .update(`${relativePath}:${nodePath}`)
    .digest('hex')
    .slice(0, STAMP_ID_LENGTH)
}

/** Right after the tag name, before any attributes — works whether the tag has 0 or N already. */
function insertionPointFor(element: ElementNode): number {
  return element.loc.start.offset + 1 + element.tag.length
}

export function stamp(text: string, context: StampContext): StampResult {
  const root = parseVueSfc(text, context.uri)

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
    // `{{ expr }}`, a locked v-html/v-t element) also carries a `node`, but stamping it as a ref
    // would offer to edit something deliberately locked at extract time.
    const refs = block.segments
      .filter((segment) => segment.kind === 'text' && segment.editable && segment.node)
      .map((segment) => segment.node!)
    if (refs.length === 0) continue

    const id = stampId(context.relativePath, elementPath)
    magic.appendLeft(insertionPointFor(element), ` data-vf="${id}"`)

    entries.push({
      id,
      relativePath: context.relativePath,
      format: 'vue',
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
