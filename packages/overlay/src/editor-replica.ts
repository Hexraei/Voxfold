/**
 * The in-place editor: a typography-cloned replica of the flagged block, positioned exactly over
 * it, rather than `contenteditable` on the page's own DOM node.
 *
 * `contenteditable` directly on a node React/Vue/Svelte owns is unsafe: a re-render or an HMR
 * update can replace that node out from under an in-progress edit at any moment, silently
 * discarding it. A replica is a plain `<div>` this module fully owns, positioned via
 * `getBoundingClientRect()` and cloned computed styles so it reads identically to the block it
 * covers, with editing happening entirely inside it — the real page is never touched until commit.
 */

const EDITOR_ACCENT_COLOR = '#0ea5e9'
const EDITOR_BORDER_WIDTH = 2
const HANDLE_SIZE = 6

// Deliberately no `margin`: the wrapper is already positioned and sized from the source
// element's OWN getBoundingClientRect() (which already reflects any margin, including an
// `auto` margin centering a narrower block inside a wider parent) — cloning margin onto `el`
// as well double-applies it, shifting the editable box away from the wrapper (and its corner
// handles) it's supposed to fill exactly. Reproduced with a `margin: 0 auto` centered block:
// the wrapper and the editable div's actual rects were off by over 200px horizontally.
const CLONED_PROPERTIES = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'color',
  'text-align',
  'text-transform',
  'white-space',
  'word-spacing',
  'padding',
] as const

export interface EditorReplica {
  element: HTMLDivElement
  /** Current text content of the editable area. */
  getValue(): string
  setValue(value: string): void
  setCaret(offset: number): void
  destroy(): void
  onInput(handler: (value: string) => void): void
  onCommit(handler: () => void): void
  onCancel(handler: () => void): void
}

/**
 * @param sourceElement The rendered block element to clone typography and position from.
 * @param initialText The block's current flat text (the replica starts as plain text, not HTML,
 *   so a person can't accidentally type markup that gets interpreted as structure).
 */
export function createEditorReplica(sourceElement: Element, initialText: string): EditorReplica {
  const computed = getComputedStyle(sourceElement)
  const rect = sourceElement.getBoundingClientRect()

  // The replica is transparent (see below) so the real page's background shows through it —
  // but with the source element's own text still rendered underneath at its own line-wrapped
  // width, the two visibly overlap the moment the replica's width/font metrics don't match to
  // the pixel (which they don't have to, e.g. a scrollbar appearing changes available width).
  // Hidden here, restored in destroy() (every exit path — commit, cancel, Escape — calls it),
  // via `visibility`, not `display`, so the page's own layout never reflows around the edit.
  const sourceEl = sourceElement instanceof HTMLElement ? sourceElement : null
  const previousVisibility = sourceEl?.style.visibility ?? ''
  if (sourceEl) sourceEl.style.visibility = 'hidden'

  // A non-editable positioning wrapper holds the actual contenteditable plus the decorative
  // corner handles as SIBLINGS, not children of the editable node — putting the handles inside
  // the editable div would make them part of its content: `el.textContent` (what getValue()
  // and setCaretAt() both depend on) would include them, and a user selecting-and-typing over
  // the whole block could delete a handle's DOM node entirely.
  const wrapper = document.createElement('div')
  wrapper.style.position = 'fixed'
  wrapper.style.left = `${rect.left}px`
  wrapper.style.top = `${rect.top}px`
  wrapper.style.width = `${rect.width}px`
  wrapper.style.zIndex = '2147483001'
  // Appended inside the overlay root, which is `pointer-events: none` so the full-viewport
  // layer never blocks clicks on the real page — every actual interactive element inside it,
  // this one included, has to opt back in explicitly or it's visible but unclickable.
  wrapper.style.pointerEvents = 'none'

  const el = document.createElement('div')
  el.contentEditable = 'true'
  // The browser's own native spellcheck squiggle (red, not something CSS can restyle or
  // disable the color of) was rendering underneath words inside the editor at the same time as
  // Voxfold's own blue selection border/handles — two different, uncoordinated underline/color
  // systems stacked on the same text reads as "double colored," which is exactly the complaint.
  // Voxfold already tells you what's wrong with the text; a second, unrelated red squiggle
  // system layered on top adds noise, not information.
  el.spellcheck = false
  // A normal in-flow child, not `position: absolute; inset: 0` — the wrapper has no height of
  // its own, so it must be SIZED BY its content (this div growing as the user types past the
  // original block's line count), not the other way around. Absolute-positioning el to fill a
  // wrapper that never grows past its initial rect left the border/handles stuck at the
  // original (often shorter) height while the actual editable text overflowed below them.
  el.style.position = 'relative'
  el.style.minHeight = `${rect.height}px`
  el.style.width = '100%'
  el.style.pointerEvents = 'auto'
  el.style.boxSizing = 'border-box'
  // A single, solid, thick border — no separate glow/shadow ring layered on top of it, which
  // read as a "double border" rather than one clean selection box.
  el.style.border = `${EDITOR_BORDER_WIDTH}px solid ${EDITOR_ACCENT_COLOR}`
  // Transparent, not a fixed white fill: the replica sits exactly over the real block (same
  // rect, same cloned typography including `color`), so the page's own background — whatever
  // it is, light or dark — should show through underneath the text. A solid background here
  // was showing as a jarring white box over dark sections instead of blending in.
  el.style.background = 'transparent'
  el.style.whiteSpace = 'pre-wrap'

  for (const property of CLONED_PROPERTIES) {
    const value = computed.getPropertyValue(property)
    if (value) el.style.setProperty(property, value)
  }

  el.textContent = initialText
  wrapper.appendChild(el)

  // Four small corner handles, Figma's own visual signature for "this is the selected/editable
  // region" — purely decorative (not draggable; this replica's size always matches the source
  // block exactly). Solid fill in the same single accent color as the border, no separate
  // border of their own — a bordered handle on top of a bordered box was the other half of the
  // "double border" look. Centered exactly on the border line (offset by half the handle size
  // minus half the border width), not floating outside it.
  const handleOffset = HANDLE_SIZE / 2 + EDITOR_BORDER_WIDTH / 2
  for (const corner of ['tl', 'tr', 'bl', 'br'] as const) {
    const handle = document.createElement('div')
    handle.style.position = 'absolute'
    handle.style.width = `${HANDLE_SIZE}px`
    handle.style.height = `${HANDLE_SIZE}px`
    handle.style.background = EDITOR_ACCENT_COLOR
    handle.style.borderRadius = '1px'
    handle.style.pointerEvents = 'none'
    handle.style.top = corner.startsWith('t') ? `-${handleOffset}px` : 'auto'
    handle.style.bottom = corner.startsWith('b') ? `-${handleOffset}px` : 'auto'
    handle.style.left = corner.endsWith('l') ? `-${handleOffset}px` : 'auto'
    handle.style.right = corner.endsWith('r') ? `-${handleOffset}px` : 'auto'
    wrapper.appendChild(handle)
  }

  const inputHandlers: Array<(value: string) => void> = []
  const commitHandlers: Array<() => void> = []
  const cancelHandlers: Array<() => void> = []
  let settled = false // guards against both Enter and the ensuing blur firing a double commit

  const commitOnce = () => {
    if (settled) return
    settled = true
    for (const handler of commitHandlers) handler()
  }

  el.addEventListener('input', () => {
    for (const handler of inputHandlers) handler(el.textContent ?? '')
  })

  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      commitOnce()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      settled = true
      for (const handler of cancelHandlers) handler()
    }
  })

  // Clicking anywhere outside the editor commits, the same way Figma's own text boxes work —
  // `focusout` (not `blur`, which doesn't bubble) fires for both a real pointer click elsewhere
  // and a programmatic focus change, so Enter's own commit path setting `settled` first is what
  // keeps the two from double-firing.
  el.addEventListener('focusout', commitOnce)

  // `wrapper` is `position: fixed` (viewport-relative) so it can sit above everything regardless
  // of any ancestor's own stacking/overflow context — but that also means it does NOT
  // automatically track sourceElement's position as the page scrolls, the way an `absolute`
  // element in normal flow would. Left alone, scrolling the page moves the real (hidden) text
  // out from under a box that stays glued to the same spot on screen — the box visibly
  // "follows" the scroll instead of tracking its target. Recomputing left/top from the source
  // element's live getBoundingClientRect() on every scroll/resize keeps it locked to the text
  // it covers; `getBoundingClientRect()` stays accurate on a `visibility: hidden` element since
  // hidden (unlike `display: none`) still participates in layout.
  const reposition = () => {
    const liveRect = sourceElement.getBoundingClientRect()
    wrapper.style.left = `${liveRect.left}px`
    wrapper.style.top = `${liveRect.top}px`
    wrapper.style.width = `${liveRect.width}px`
  }
  window.addEventListener('scroll', reposition, true)
  window.addEventListener('resize', reposition)

  return {
    element: wrapper,
    getValue: () => el.textContent ?? '',
    setValue: (value) => {
      el.textContent = value
    },
    setCaret: (offset) => setCaretAt(el, offset),
    destroy: () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      wrapper.remove()
      if (sourceEl) sourceEl.style.visibility = previousVisibility
    },
    onInput: (handler) => inputHandlers.push(handler),
    onCommit: (handler) => commitHandlers.push(handler),
    onCancel: (handler) => cancelHandlers.push(handler),
  }
}

/** Place the caret at a plain-text character offset within `el`'s single text node. */
function setCaretAt(el: HTMLElement, offset: number): void {
  const textNode = el.firstChild
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return
  const clamped = Math.max(0, Math.min(offset, textNode.textContent?.length ?? 0))
  const range = document.createRange()
  range.setStart(textNode, clamped)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  // preventScroll: the caller (App.tsx's openPopoverForFlag) already scrolls the flagged text
  // into view itself, timed against its own popover-repositioning logic — a plain focus() here
  // triggers the browser's OWN native "scroll the newly focused element into view" behavior on
  // top of that, and the two fighting each other is what was producing a visible scroll jump
  // right as the editor opened.
  el.focus({ preventScroll: true })
}
