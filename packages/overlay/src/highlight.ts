/**
 * Renders underlines for flagged text using the CSS Custom Highlight API when the browser
 * supports it, and falls back to absolutely-positioned boxes when it doesn't (Firefox, and older
 * Safari/Chrome — the plan's own risk register calls this out explicitly).
 *
 * `CSS.highlights` is the right primitive here because it never touches the page's own DOM: a
 * `Highlight` is a set of `Range`s registered under a name, and `::highlight(name)` styles them —
 * nothing is inserted, wrapped, or mutated in the tree the framework owns. The fallback can't
 * make that same promise as cleanly (a positioned box sits in a portal, not inside the flagged
 * text, so it can never accidentally re-parent something React or Vue is managing), which is
 * exactly why it's a fallback and not the primary approach.
 */

const HIGHLIGHT_PREFIX = 'voxfold'

const CATEGORY_COLORS: Record<string, string> = {
  punctuation: '#f59e0b',
  'plain-words': '#0ea5e9',
  intensifier: '#8b5cf6',
  'inanimate-adverb': '#8b5cf6',
  buzzword: '#ec4899',
  'opener-closer': '#ec4899',
  construction: '#ef4444',
  markdown: '#f59e0b',
}

const DEFAULT_COLOR = '#64748b'

export function colorForCategory(category: string): string {
  return CATEGORY_COLORS[category] ?? DEFAULT_COLOR
}

export interface HighlightEntry {
  id: string
  range: Range
  category: string
}

function supportsCssHighlights(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
}

/** One `<div>` per flagged range, absolutely positioned over it — the no-CSS.highlights fallback. */
class BoxFallbackRenderer {
  private readonly container: HTMLElement
  private readonly boxes = new Map<string, HTMLElement>()
  private entries: HighlightEntry[] = []

  constructor(container: HTMLElement) {
    this.container = container
  }

  render(entries: readonly HighlightEntry[]): void {
    this.entries = [...entries]
    this.reposition()
  }

  /** Recompute box positions without changing which ranges are highlighted (scroll/resize). */
  reposition(): void {
    const seen = new Set<string>()
    for (const entry of this.entries) {
      seen.add(entry.id)
      const rects = Array.from(entry.range.getClientRects())
      let box = this.boxes.get(entry.id)
      if (!box) {
        box = document.createElement('div')
        box.dataset.vfHighlightId = entry.id
        box.style.position = 'fixed'
        box.style.pointerEvents = 'none'
        box.style.borderBottom = '2px solid'
        box.style.zIndex = '2147483000'
        this.container.appendChild(box)
        this.boxes.set(entry.id, box)
      }
      box.style.borderBottomColor = colorForCategory(entry.category)
      // A range spanning an inline tag yields multiple client rects; the fallback draws only the
      // first (a full multi-rect fallback would need one box per rect, not attempted here since
      // CSS.highlights — the primary path — already handles multi-rect ranges correctly).
      const rect = rects[0]
      if (!rect) {
        box.style.display = 'none'
        continue
      }
      box.style.display = 'block'
      box.style.left = `${rect.left}px`
      box.style.top = `${rect.top}px`
      box.style.width = `${rect.width}px`
      box.style.height = `${rect.height}px`
    }

    for (const [id, box] of this.boxes) {
      if (!seen.has(id)) {
        box.remove()
        this.boxes.delete(id)
      }
    }
  }

  clear(): void {
    for (const box of this.boxes.values()) box.remove()
    this.boxes.clear()
    this.entries = []
  }
}

/** Registers Ranges with `CSS.highlights` under one Highlight object per category. */
class CssHighlightRenderer {
  private readonly byCategory = new Map<string, InstanceType<typeof Highlight>>()

  render(entries: readonly HighlightEntry[]): void {
    const grouped = new Map<string, Range[]>()
    for (const entry of entries) {
      const list = grouped.get(entry.category) ?? []
      list.push(entry.range)
      grouped.set(entry.category, list)
    }

    // Clear categories no longer present.
    for (const category of this.byCategory.keys()) {
      if (!grouped.has(category)) {
        CSS.highlights.delete(`${HIGHLIGHT_PREFIX}-${category}`)
        this.byCategory.delete(category)
      }
    }

    for (const [category, ranges] of grouped) {
      const highlight = new Highlight(...ranges)
      this.byCategory.set(category, highlight)
      CSS.highlights.set(`${HIGHLIGHT_PREFIX}-${category}`, highlight)
    }
  }

  clear(): void {
    for (const category of this.byCategory.keys()) {
      CSS.highlights.delete(`${HIGHLIGHT_PREFIX}-${category}`)
    }
    this.byCategory.clear()
  }
}

export interface HighlightRenderer {
  render(entries: readonly HighlightEntry[]): void
  /** No-op for the CSS.highlights path (ranges track the live DOM automatically); repositions
   *  fallback boxes on scroll/resize. */
  reposition(): void
  clear(): void
}

export function createHighlightRenderer(fallbackContainer: HTMLElement): HighlightRenderer {
  if (supportsCssHighlights()) {
    const renderer = new CssHighlightRenderer()
    return {
      render: (e) => renderer.render(e),
      reposition: () => {},
      clear: () => renderer.clear(),
    }
  }
  const renderer = new BoxFallbackRenderer(fallbackContainer)
  return {
    render: (e) => renderer.render(e),
    reposition: () => renderer.reposition(),
    clear: () => renderer.clear(),
  }
}

/** Generate the `::highlight(name) { text-decoration: ... }` CSS rules for every known category. */
export function highlightStylesheet(): string {
  return Object.entries(CATEGORY_COLORS)
    .map(
      ([category, color]) =>
        `::highlight(${HIGHLIGHT_PREFIX}-${category}) { text-decoration: underline wavy ${color}; text-decoration-thickness: 2px; }`,
    )
    .join('\n')
}
