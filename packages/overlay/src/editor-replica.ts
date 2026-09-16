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
  'margin',
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
  wrapper.style.minHeight = `${rect.height}px`
  wrapper.style.zIndex = '2147483001'
  // Appended inside the overlay root, which is `pointer-events: none` so the full-viewport
  // layer never blocks clicks on the real page — every actual interactive element inside it,
  // this one included, has to opt back in explicitly or it's visible but unclickable.
  wrapper.style.pointerEvents = 'none'

  const el = document.createElement('div')
  el.contentEditable = 'true'
  el.spellcheck = true
  el.style.position = 'absolute'
  el.style.inset = '0'
  el.style.pointerEvents = 'auto'
  el.style.boxSizing = 'border-box'
  // A Figma-style selection box: a solid 1px border (not an outline, so the corner handles can
  // sit exactly on it) plus a soft glow instead of a thick colored outline — reads as "this
  // region is being edited" without the heavier, more intrusive look outline gave it.
  el.style.border = '1px solid #0ea5e9'
  el.style.borderRadius = '2px'
  el.style.boxShadow = '0 0 0 3px rgba(14, 165, 233, 0.15)'
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
  // block exactly).
  for (const corner of ['tl', 'tr', 'bl', 'br'] as const) {
    const handle = document.createElement('div')
    handle.style.position = 'absolute'
    handle.style.width = '6px'
    handle.style.height = '6px'
    handle.style.background = '#fff'
    handle.style.border = '1.5px solid #0ea5e9'
    handle.style.borderRadius = '1px'
    handle.style.pointerEvents = 'none'
    handle.style.top = corner.startsWith('t') ? '-4px' : 'auto'
    handle.style.bottom = corner.startsWith('b') ? '-4px' : 'auto'
    handle.style.left = corner.endsWith('l') ? '-4px' : 'auto'
    handle.style.right = corner.endsWith('r') ? '-4px' : 'auto'
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

  return {
    element: wrapper,
    getValue: () => el.textContent ?? '',
    setValue: (value) => {
      el.textContent = value
    },
    setCaret: (offset) => setCaretAt(el, offset),
    destroy: () => wrapper.remove(),
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
  el.focus()
}
