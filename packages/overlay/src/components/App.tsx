/**
 * The overlay's root component: owns the lint loop (DOM flatten → worker → highlights), the
 * badge/panel UI, and dispatches to the commit flow when an edit is confirmed. Rendered once into
 * `mountOverlay`'s Shadow DOM layer by the integration package's own bootstrap entry point (e.g.
 * `@voxfold/vite`'s dev-server injection script).
 */

import type { Flag } from '@voxfold/core'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { ApiClient } from '../api-client.ts'
import { flattenDocument, type TextRef } from '../dom-flatten.ts'
import { createEditorReplica, type EditorReplica } from '../editor-replica.ts'
import { createHighlightRenderer, type HighlightRenderer } from '../highlight.ts'
import { resolveFlagToDom } from '../resolve-flag.ts'
import type { LintWorkerClient } from '../worker-client.ts'
import { Badge } from './Badge.tsx'
import { FlagPanel } from './FlagPanel.tsx'
import { FlagPopover } from './FlagPopover.tsx'

const RELINT_DEBOUNCE_MS = 300

export interface AppProps {
  worker: LintWorkerClient
  api: ApiClient
  layer: HTMLElement
  overlayRoot: HTMLElement
}

interface LintState {
  flags: Flag[]
  score: import('@voxfold/core').Score | null
}

export function App(props: AppProps) {
  const { worker, api, layer, overlayRoot } = props

  const [lintState, setLintState] = useState<LintState>({ flags: [], score: null })
  const [highlightsOn, setHighlightsOn] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [selectedFlag, setSelectedFlag] = useState<Flag | null>(null)
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [toast, setToast] = useState<{ message: string; undoPath?: string } | null>(null)

  const blocksRef = useRef<ReturnType<typeof flattenDocument>['blocks']>([])
  const refsRef = useRef<TextRef[]>([])
  const rendererRef = useRef<HighlightRenderer | null>(null)
  const editorRef = useRef<EditorReplica | null>(null)
  const relintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const relint = useCallback(() => {
    const { blocks, refs } = flattenDocument(document.body, { overlayRoot })
    blocksRef.current = blocks
    refsRef.current = refs
    worker
      .lintDocument({ uri: 'live', format: 'html', blocks, directives: [] })
      .then((result) => setLintState({ flags: result.flags, score: result.score }))
      .catch(() => {
        // A stale/disposed worker request: the next mutation observer tick re-lints anyway.
      })
  }, [worker, overlayRoot])

  const scheduleRelint = useCallback(() => {
    if (editing) return // Paused while an editor is open, per the plan's HMR-mid-edit rule.
    if (relintTimer.current) clearTimeout(relintTimer.current)
    relintTimer.current = setTimeout(relint, RELINT_DEBOUNCE_MS)
  }, [relint, editing])

  // Initial lint, then re-lint on DOM mutation (debounced) and on vite:afterUpdate.
  useEffect(() => {
    relint()
    const observer = new MutationObserver(scheduleRelint)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    const onViteUpdate = () => scheduleRelint()
    window.addEventListener('vite:afterUpdate', onViteUpdate)

    return () => {
      observer.disconnect()
      window.removeEventListener('vite:afterUpdate', onViteUpdate)
      if (relintTimer.current) clearTimeout(relintTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reposition highlight fallback boxes on scroll/resize.
  useEffect(() => {
    if (!rendererRef.current) return
    const reposition = () => rendererRef.current?.reposition()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [lintState])

  // Render/clear highlights based on the toggle and current flags.
  useEffect(() => {
    if (!rendererRef.current) rendererRef.current = createHighlightRenderer(layer)
    const renderer = rendererRef.current

    if (!highlightsOn) {
      renderer.clear()
      return
    }
    // Exclude every flag in the block currently being edited: a CSS Custom Highlight paints
    // independently of the Range's own element's `visibility` (confirmed empirically — hiding
    // the source element while the replica edits on top of it does NOT stop its `::highlight()`
    // wavy underline from still rendering through), so the only way to actually stop a flagged
    // word's underline from showing while its block is being edited is to stop registering a
    // Range for it in the first place.
    const editingBlockId = editing ? selectedFlag?.blockId : undefined
    const entries = lintState.flags
      .filter((flag) => flag.blockId !== editingBlockId)
      .flatMap((flag) => {
        const resolved = resolveFlagToDom(flag, blocksRef.current, refsRef.current)
        return resolved.map((r) => ({ id: flag.hash, range: r.range, category: flag.category }))
      })
    renderer.render(entries)
  }, [highlightsOn, lintState, layer, editing, selectedFlag])

  // Alt+Shift+V toggles highlights globally.
  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'v') {
        setHighlightsOn((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [])

  const openPopoverForFlag = useCallback((flag: Flag) => {
    const resolved = resolveFlagToDom(flag, blocksRef.current, refsRef.current)
    const first = resolved[0]
    if (first) {
      const target = first.range.startContainer.parentElement
      const targetRect = target?.getBoundingClientRect()
      // Only scroll when the target genuinely isn't fully visible — `scrollIntoView({block:
      // 'center'})` re-centers unconditionally even when the element is already fully on
      // screen, which was producing a visible, unnecessary jump on every single click/
      // double-click, including ones on text already comfortably in view.
      const alreadyVisible =
        targetRect &&
        targetRect.top >= 0 &&
        targetRect.bottom <= window.innerHeight &&
        targetRect.left >= 0 &&
        targetRect.right <= window.innerWidth
      if (!alreadyVisible) {
        target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
      const reposition = () => {
        const rect = first.range.getBoundingClientRect()
        setPopoverPosition({ top: rect.bottom + 8, left: rect.left })
      }
      // Position AFTER scrollIntoView settles, not before: reading getBoundingClientRect() here
      // and then scrolling (especially with smooth-scroll's own animation) leaves the popover's
      // `position: fixed` coordinates stale against wherever the page ends up, not where the
      // flagged text actually lands — reproduced with a flag far enough down the page that the
      // popover rendered hundreds of pixels off-screen. requestAnimationFrame alone can still
      // fire mid-scroll on some engines; a short delay matched to typical smooth-scroll duration
      // is the pragmatic fix here, not a real "scroll finished" event (scrollIntoView has none).
      // When nothing needed scrolling, this still costs nothing — reposition() is idempotent.
      reposition()
      if (!alreadyVisible) window.setTimeout(reposition, 400)
    } else {
      setPopoverPosition(null)
    }
    setSelectedFlag(flag)
  }, [])

  const closePopover = useCallback(() => {
    setSelectedFlag(null)
    setPopoverPosition(null)
  }, [])

  const commitEdit = useCallback(
    async (flag: Flag, newFullText: string) => {
      const resolved = resolveFlagToDom(flag, blocksRef.current, refsRef.current)
      const target = resolved[0]
      if (!target?.ref) return

      try {
        const stampId = findStampId(target.ref.node.parentElement)
        if (!stampId) throw new Error('no data-vf ancestor found for this text')
        const resolvedRefs = await api.resolve(stampId)
        const matchingRef = resolvedRefs.refs[0]
        if (!matchingRef) throw new Error('server could not resolve this text to a source ref')

        const planned = await api.plan(resolvedRefs.relativePath, [
          { ref: matchingRef.ref, expectedOldText: target.ref.node.data, newText: newFullText },
        ])
        await api.apply(resolvedRefs.relativePath, planned.fileHash, [
          { ref: matchingRef.ref, expectedOldText: target.ref.node.data, newText: newFullText },
        ])
        setToast({ message: 'Saved.', undoPath: resolvedRefs.relativePath })
      } catch (error) {
        setToast({
          message: error instanceof Error ? `Could not save: ${error.message}` : 'Could not save.',
        })
      } finally {
        editorRef.current?.destroy()
        editorRef.current = null
        setEditing(false)
        closePopover()
      }
    },
    [api, closePopover],
  )

  const undoLastEdit = useCallback(
    async (relativePath: string) => {
      try {
        await api.undo(relativePath)
        setToast({ message: 'Undone.' })
        scheduleRelint()
      } catch (error) {
        setToast({
          message: error instanceof Error ? `Could not undo: ${error.message}` : 'Could not undo.',
        })
      }
    },
    [api, scheduleRelint],
  )

  /**
   * Opens the in-page editor for `flag` directly, without going through `selectedFlag` state
   * first — needed by the double-click-on-underline path, where setting `selectedFlag` and then
   * immediately reading it back in the same handler would race Preact's async state update and
   * see the stale (null) value. The "Manual fix" popover button still goes through
   * `startEdit()` below, which just forwards the already-selected flag here.
   */
  const startEditForFlag = useCallback(
    (flag: Flag) => {
      const resolved = resolveFlagToDom(flag, blocksRef.current, refsRef.current)
      const target = resolved[0]
      if (!target?.ref) return

      const sourceElement = target.ref.node.parentElement
      if (!sourceElement) return

      setEditing(true)
      const replica = createEditorReplica(sourceElement, target.ref.node.data)
      editorRef.current = replica
      layer.appendChild(replica.element)
      replica.setCaret(flag.flatRange[0])

      replica.onCancel(() => {
        replica.destroy()
        editorRef.current = null
        setEditing(false)
      })

      replica.onCommit(() => {
        commitEdit(flag, replica.getValue())
      })
    },
    [commitEdit, layer],
  )

  const startEdit = useCallback(() => {
    if (!selectedFlag) return
    startEditForFlag(selectedFlag)
  }, [selectedFlag, startEditForFlag])

  // Double-clicking a highlighted (underlined) word jumps straight into the editor — the popover
  // still opens first (same position logic openPopoverForFlag already uses) so a double-click
  // reads as "select, then immediately edit" rather than skipping the selection UI entirely.
  useEffect(() => {
    if (!highlightsOn) return

    const onDblClick = (event: MouseEvent) => {
      const point = document.caretPositionFromPoint?.(event.clientX, event.clientY)
      if (!point) return

      for (const flag of lintState.flags) {
        const resolved = resolveFlagToDom(flag, blocksRef.current, refsRef.current)
        const hit = resolved.some(({ range }) => {
          try {
            return range.isPointInRange(point.offsetNode, point.offset)
          } catch {
            // isPointInRange throws if offsetNode isn't in the same tree as the range's — not
            // this flag's range, just try the next one.
            return false
          }
        })
        if (hit) {
          event.preventDefault()
          openPopoverForFlag(flag)
          startEditForFlag(flag)
          return
        }
      }
    }

    document.addEventListener('dblclick', onDblClick)
    return () => document.removeEventListener('dblclick', onDblClick)
  }, [highlightsOn, lintState, openPopoverForFlag, startEditForFlag])

  /**
   * A mechanical fix or suggestion's edits are `SourceEdit`s in the SAME per-segment-local
   * coordinate space `resolveFlagToDom` already resolves flag ranges into (see the source-edits
   * translation doc in `@voxfold/core`) — not file offsets, since these flags came from a
   * DOM-flattened document that never had a real file to begin with. Applying them here is the
   * same splice `applyFixes` does for a real file, just against the live text node's current
   * value instead of a source string.
   */
  const applySuggestion = useCallback(
    (flag: Flag, edits: ReadonlyArray<{ start: number; end: number; text: string }>) => {
      const resolved = resolveFlagToDom(flag, blocksRef.current, refsRef.current)
      const target = resolved[0]
      if (!target?.ref) return

      // `edit.start`/`.end` are relative to this ref's own span (see `TextRef` in
      // `dom-flatten.ts`), not to `node.data` as a whole — `flattenDocument` can trim leading
      // whitespace off a text node's span, which is exactly the same offset the ref itself was
      // recorded with. Add `ref.start` to land the splice at the real position in the full node.
      const ref = target.ref
      const original = ref.node.data
      const sorted = [...edits].sort((a, b) => a.start - b.start)
      let patched = ''
      let cursor = 0
      for (const edit of sorted) {
        const start = ref.start + edit.start
        const end = ref.start + edit.end
        patched += original.slice(cursor, start) + edit.text
        cursor = end
      }
      patched += original.slice(cursor)

      commitEdit(flag, patched)
    },
    [commitEdit],
  )

  const ignoreFlag = useCallback(
    async (flag: Flag) => {
      const resolved = resolveFlagToDom(flag, blocksRef.current, refsRef.current)
      const stampId = findStampId(resolved[0]?.ref?.node.parentElement ?? null)
      if (!stampId) return
      const resolvedRefs = await api.resolve(stampId)
      await api.suppress(resolvedRefs.relativePath, flag.ruleId, flag.hash)
      closePopover()
      scheduleRelint()
    },
    [api, closePopover, scheduleRelint],
  )

  const openInEditorFor = useCallback(
    async (flag: Flag) => {
      const resolved = resolveFlagToDom(flag, blocksRef.current, refsRef.current)
      const stampId = findStampId(resolved[0]?.ref?.node.parentElement ?? null)
      if (!stampId) return
      const resolvedRefs = await api.resolve(stampId)
      await api.openInEditor(resolvedRefs.relativePath)
    },
    [api],
  )

  const flagCount = lintState.flags.length
  const selectedResolution = selectedFlag
    ? resolveFlagToDom(selectedFlag, blocksRef.current, refsRef.current)[0]
    : undefined

  return (
    <>
      <Badge
        score={lintState.score}
        flagCount={flagCount}
        highlightsOn={highlightsOn}
        onToggleHighlights={() => setHighlightsOn((prev) => !prev)}
        onTogglePanel={() => setPanelOpen((prev) => !prev)}
        panelOpen={panelOpen}
      />
      {panelOpen ? (
        <FlagPanel
          flags={lintState.flags}
          onSelectFlag={openPopoverForFlag}
          selectedFlagHash={selectedFlag?.hash}
        />
      ) : null}
      {selectedFlag && popoverPosition && !editing ? (
        <FlagPopover
          flag={selectedFlag}
          editable={selectedResolution?.editable ?? false}
          style={{
            position: 'fixed',
            top: `${popoverPosition.top}px`,
            left: `${popoverPosition.left}px`,
          }}
          onEdit={startEdit}
          onApplyFix={() => {
            if (selectedFlag.fix) applySuggestion(selectedFlag, selectedFlag.fix)
          }}
          onApplySuggestion={(_label, index) => {
            const suggestion = selectedFlag.suggestions?.[index]
            if (suggestion) applySuggestion(selectedFlag, suggestion.edits)
          }}
          onIgnore={() => ignoreFlag(selectedFlag)}
          onOpenInEditor={() => openInEditorFor(selectedFlag)}
          onClose={closePopover}
        />
      ) : null}
      {toast ? (
        <div class="vf-toast">
          {toast.message}
          {toast.undoPath ? (
            <button
              type="button"
              onClick={() => {
                const path = toast.undoPath
                setToast(null)
                if (path) undoLastEdit(path)
              }}
            >
              Undo
            </button>
          ) : null}
          <button type="button" onClick={() => setToast(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
    </>
  )
}

function findStampId(el: Element | null): string | null {
  let current = el
  while (current) {
    const id = current.getAttribute?.('data-vf')
    if (id) return id
    current = current.parentElement
  }
  return null
}
