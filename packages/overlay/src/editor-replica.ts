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

  const el = document.createElement('div')
  el.contentEditable = 'true'
  el.spellcheck = true
  el.style.position = 'fixed'
  el.style.left = `${rect.left}px`
  el.style.top = `${rect.top}px`
  el.style.width = `${rect.width}px`
  el.style.minHeight = `${rect.height}px`
  el.style.boxSizing = 'border-box'
  el.style.outline = '2px solid #0ea5e9'
  el.style.outlineOffset = '2px'
  el.style.background = 'var(--vf-editor-bg, #fff)'
  el.style.zIndex = '2147483001'
  el.style.whiteSpace = 'pre-wrap'

  for (const property of CLONED_PROPERTIES) {
    const value = computed.getPropertyValue(property)
    if (value) el.style.setProperty(property, value)
  }

  el.textContent = initialText

  const inputHandlers: Array<(value: string) => void> = []
  const commitHandlers: Array<() => void> = []
  const cancelHandlers: Array<() => void> = []

  el.addEventListener('input', () => {
    for (const handler of inputHandlers) handler(el.textContent ?? '')
  })

  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      for (const handler of commitHandlers) handler()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      for (const handler of cancelHandlers) handler()
    }
  })

  return {
    element: el,
    getValue: () => el.textContent ?? '',
    setValue: (value) => {
      el.textContent = value
    },
    setCaret: (offset) => setCaretAt(el, offset),
    destroy: () => el.remove(),
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
