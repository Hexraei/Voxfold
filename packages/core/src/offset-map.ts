/**
 * OffsetMap: translate positions in a flattened block string back to source positions.
 *
 * This is the single most important shared piece of infrastructure: every adapter flattens a
 * block's inline children into one continuous string so rules can match across `<strong>` and
 * `**bold**` boundaries, and every flag must then be mapped back to exact source offsets so the
 * writer can patch the right bytes.
 */

import type { NodeRef, Offset, Segment, SourceRange } from './types.ts'

/** A source range plus the segment it belongs to, so writers know which AST node to patch. */
export interface MappedRange extends SourceRange {
  segment: Segment
  node?: NodeRef
  editable: boolean
}

/** Which side of a segment boundary an offset belongs to. */
export type Bias = 'start' | 'end'

export class OffsetMap {
  readonly segments: readonly Segment[]

  constructor(segments: readonly Segment[]) {
    this.segments = segments
  }

  /** Index of the segment containing `flat`, honouring `bias` at segment boundaries. */
  private segmentIndexAt(flat: Offset, bias: Bias): number {
    const segments = this.segments
    if (segments.length === 0) return -1

    // Binary search for the segment whose [flatStart, flatEnd) contains `flat`. With bias 'end'
    // an offset sitting exactly on a boundary belongs to the segment that ends there.
    let lo = 0
    let hi = segments.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const seg = segments[mid]!
      if (flat < seg.flatStart) hi = mid - 1
      else if (flat >= seg.flatEnd) lo = mid + 1
      else return mid
    }

    // `flat` fell on a boundary (or outside). `lo` is the first segment starting after it.
    if (bias === 'end' && lo > 0) return lo - 1
    if (lo < segments.length) return lo
    return segments.length - 1
  }

  /** The segment containing `flat`, or undefined when the map is empty. */
  segmentAt(flat: Offset, bias: Bias = 'start'): Segment | undefined {
    const index = this.segmentIndexAt(flat, bias)
    return index === -1 ? undefined : this.segments[index]
  }

  /**
   * Source offset for a flat offset.
   *
   * `bias` decides what happens exactly on a segment boundary: 'start' maps to the beginning of
   * the following segment (where an inserted character would go), 'end' to the end of the
   * preceding one. Returns undefined for segments with no source (inserted boundaries).
   */
  toSource(flat: Offset, bias: Bias = 'start'): Offset | undefined {
    const segment = this.segmentAt(flat, bias)
    if (!segment?.src) return undefined

    const local = flat - segment.flatStart
    if (segment.charMap) {
      // charMap has one entry per flat char; the position just past the last char maps to the
      // segment's source end (it is an insertion point, not a character).
      if (local >= segment.charMap.length) return segment.src.end
      return segment.charMap[Math.max(0, local)]
    }
    const clamped = Math.max(0, Math.min(local, segment.src.end - segment.src.start))
    return segment.src.start + clamped
  }

  /**
   * Map a flat range to source ranges: one per segment it spans, in order.
   *
   * A match like "not just X, it's Y" can cross `<strong>` boundaries, so it yields several
   * ranges. Segments without source (inserted boundaries) are skipped. Placeholder segments are
   * included but never editable, so callers can refuse edits that would touch an expression.
   */
  toSourceRanges(flatStart: Offset, flatEnd: Offset): MappedRange[] {
    if (flatEnd < flatStart) return []
    const ranges: MappedRange[] = []

    for (const segment of this.segments) {
      if (segment.flatEnd <= flatStart && segment.flatStart < flatStart) continue
      if (segment.flatStart >= flatEnd && segment.flatEnd > flatEnd) continue
      if (!segment.src) continue

      // Empty ranges only matter for a zero-width match (a caret position).
      const overlapStart = Math.max(segment.flatStart, flatStart)
      const overlapEnd = Math.min(segment.flatEnd, flatEnd)
      if (overlapStart > overlapEnd) continue
      if (overlapStart === overlapEnd && flatStart !== flatEnd) continue

      const start = this.offsetWithin(segment, overlapStart, 'start')
      const end = this.offsetWithin(segment, overlapEnd, 'end')
      ranges.push({
        start,
        end,
        segment,
        editable: segment.editable,
        ...(segment.node ? { node: segment.node } : {}),
      })
    }

    return ranges
  }

  /** Source offset of a flat offset known to lie within `segment`. */
  private offsetWithin(segment: Segment, flat: Offset, bias: Bias): Offset {
    const src = segment.src
    if (!src) throw new Error('offsetWithin called on a segment without source')
    const local = flat - segment.flatStart

    if (segment.charMap) {
      if (local <= 0) return bias === 'end' && segment.charMap.length === 0 ? src.end : src.start
      if (local >= segment.charMap.length) return src.end
      return segment.charMap[local]!
    }
    const span = src.end - src.start
    return src.start + Math.max(0, Math.min(local, span))
  }

  /** True when every source-backed segment overlapping the range is editable. */
  isEditable(flatStart: Offset, flatEnd: Offset): boolean {
    const ranges = this.toSourceRanges(flatStart, flatEnd)
    return ranges.length > 0 && ranges.every((range) => range.editable)
  }
}
