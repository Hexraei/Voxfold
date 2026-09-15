/**
 * Mounts the overlay: one root element attached directly to `document.body`, with an OPEN Shadow
 * DOM so the overlay's own styles never leak onto the page and the page's styles never leak into
 * the overlay. Open (not closed) so devtools and the overlay's own tests can still inspect it —
 * nothing about isolation here is a security boundary, since this only ever runs in dev.
 *
 * This root element is also the one thing `flattenDocument`'s `overlayRoot` option excludes from
 * every lint pass, so the overlay never reports tells about its own UI copy.
 */

export const OVERLAY_ROOT_ID = 'voxfold-overlay-root'

export interface OverlayMount {
  root: HTMLElement
  shadow: ShadowRoot
  /** Where highlight fallback boxes and popovers are appended, inside the shadow tree. */
  layer: HTMLElement
  unmount(): void
}

export function mountOverlay(styles: string): OverlayMount {
  const existing = document.getElementById(OVERLAY_ROOT_ID)
  if (existing) existing.remove() // HMR: a stale overlay from before a module reload.

  const root = document.createElement('div')
  root.id = OVERLAY_ROOT_ID
  // Fixed positioning context for the layer; the root itself has no visible box.
  root.style.position = 'fixed'
  root.style.inset = '0'
  root.style.pointerEvents = 'none'
  root.style.zIndex = '2147483000'

  const shadow = root.attachShadow({ mode: 'open' })

  const styleEl = document.createElement('style')
  styleEl.textContent = styles
  shadow.appendChild(styleEl)

  const layer = document.createElement('div')
  layer.id = 'voxfold-layer'
  shadow.appendChild(layer)

  document.body.appendChild(root)

  return {
    root,
    shadow,
    layer,
    unmount: () => root.remove(),
  }
}
