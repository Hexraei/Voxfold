/**
 * `<VoxfoldOverlay/>` — the documented FALLBACK for mounting the overlay, for apps that can't rely
 * on `instrumentationClientInject` (introduced Next 16.3.0 — see `index.ts`'s module doc for why
 * that hook is the PRIMARY path when it's available). Drop this in the root layout:
 *
 * ```tsx
 * // app/layout.tsx
 * import { VoxfoldOverlay } from '@voxfold/next/component'
 *
 * export default function RootLayout({ children }: { children: React.ReactNode }) {
 *   return (
 *     <html lang="en">
 *       <body>
 *         {children}
 *         <VoxfoldOverlay />
 *       </body>
 *     </html>
 *   )
 * }
 * ```
 *
 * MUST be a Client Component (`'use client'` below) — it calls `bootstrap()` from `overlay.ts`,
 * which touches `window`/`document` directly and has no meaning during server rendering. Mounted
 * once, on the client, via a `useEffect` with an empty dependency array — deliberately not
 * gated further on `NODE_ENV` here beyond what `bootstrap()` itself already checks, so this
 * component is safe to leave in a layout unconditionally (the standard pattern every real
 * dev-only React component — e.g. `@next/third-parties`' dev helpers — follows, rather than
 * asking every consumer to remember an `{process.env.NODE_ENV === 'development' && ...}` guard at
 * every call site).
 *
 * NOT exported from this package's main entry (`@voxfold/next`): that entry is `withVoxfold`,
 * evaluated in `next.config.js`'s Node context, which never wants a `.tsx` file (React types, JSX
 * runtime) as a dependency of its own module graph — importing `@voxfold/next/component` from
 * `next.config.js` would be a category error. Published as its own subpath, `@voxfold/next/component`
 * (see `package.json`'s `exports` map), exactly like `@voxfold/next/overlay`.
 */
'use client'

import { useEffect } from 'react'

let bootstrapped = false

export function VoxfoldOverlay(): null {
  useEffect(() => {
    if (bootstrapped) return // Strict Mode double-invokes effects in dev; mount at most once.
    bootstrapped = true
    // Dynamic import, not a static one: this keeps `overlay.ts` (and everything it pulls in —
    // preact, @voxfold/overlay) out of the initial client bundle for apps that DON'T use this
    // fallback (the common case now that instrumentationClientInject is the primary path) — it
    // only loads when this component actually mounts.
    import('./overlay.ts')
  }, [])

  return null
}

export default VoxfoldOverlay
