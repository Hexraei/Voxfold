/**
 * Maps a `Flag` (in block-flat-text coordinates, as the worker reports it) back to real DOM
 * `Range`s for highlighting, and to the `TextRef`s an edit would need to target.
 *
 * Reuses `OffsetMap.toSourceRanges` — the exact same "a match can span an inline tag, so it
 * yields one range per segment" logic every file adapter's writer relies on — rather than
 * reimplementing flat-range-to-segment splitting here. The only DOM-specific step is the last
 * one: turning a segment's local text offset into a `Range` over the real `Text` node that
 * `TextRef` points at.
 */

import { type Block, type Flag, mapOf } from '@voxfold/core'
import type { TextRef } from './dom-flatten.ts'

export interface FlagDomRange {
  range: Range
  editable: boolean
  ref?: TextRef
}

/**
 * @param refs The `TextRef[]` table `flattenDocument` returned alongside the blocks the flag's
 *   worker request was built from. Must be the SAME table — ref paths are plain array indices,
 *   meaningless against any other flattening pass.
 */
export function resolveFlagToDom(
  flag: Flag,
  blocks: readonly Block[],
  refs: readonly TextRef[],
): FlagDomRange[] {
  const block = blocks.find((b) => b.id === flag.blockId)
  if (!block) return []

  const map = mapOf(block)
  const mapped = map.toSourceRanges(flag.flatRange[0], flag.flatRange[1])

  const results: FlagDomRange[] = []
  for (const mappedRange of mapped) {
    if (mappedRange.segment.kind !== 'text' || !mappedRange.node) continue
    if (mappedRange.node.type !== 'dom-text') continue

    const refIndex = Number(mappedRange.node.path)
    const ref = refs[refIndex]
    if (!ref) continue

    // `mappedRange.start`/`.end` are offsets local to this segment's own text (see
    // `resolveFlagToDom`'s module doc — the DOM flattener always uses src=[0, length) per
    // segment), so `ref.start + local` is the offset into the real Text node's data.
    const start = ref.start + mappedRange.start
    const end = ref.start + mappedRange.end
    if (start < 0 || end > ref.node.data.length || start > end) continue

    const range = document.createRange()
    range.setStart(ref.node, start)
    range.setEnd(ref.node, end)
    results.push({ range, editable: mappedRange.editable, ref })
  }

  return results
}
