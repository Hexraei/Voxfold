import type { Flag, Score } from '@voxfold/core'
import { h, render } from 'preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Badge } from '../src/components/Badge.tsx'
import { FlagPanel } from '../src/components/FlagPanel.tsx'
import { FlagPopover } from '../src/components/FlagPopover.tsx'

function mountFor<T>(node: T): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  // biome-ignore lint/suspicious/noExplicitAny: render() accepts a VNode; T is a component call result.
  render(node as any, container)
  return container
}

afterEach(() => {
  document.body.innerHTML = ''
})

const baseFlag: Flag = {
  ruleId: 'utilize',
  kind: 'mechanical',
  category: 'plain-words',
  severity: 'warn',
  message: '"utilize" instead of "use"',
  docs: 'A plainer word reads the same and takes less effort.',
  blockId: 'block-1',
  flatRange: [3, 11],
  sourceRanges: [],
  text: 'utilize',
  contribution: 1,
  dense: false,
  editable: true,
  hash: 'hash-1',
}

const score: Score = {
  value: 82,
  grade: 'B',
  tellsPer100: 3.2,
  words: 120,
  ruleset: 'recommended@1.0.0',
}

describe('Badge', () => {
  it('renders the score, grade and flag count', () => {
    const container = mountFor(
      Badge({
        score,
        flagCount: 5,
        highlightsOn: false,
        onToggleHighlights: () => {},
        onTogglePanel: () => {},
        panelOpen: false,
      }),
    )
    expect(container.textContent).toContain('82')
    expect(container.textContent).toContain('B')
    expect(container.textContent).toContain('5 flags')
  })

  it('pluralizes the flag count', () => {
    const countText = (flagCount: number) =>
      mountFor(
        Badge({
          score,
          flagCount,
          highlightsOn: false,
          onToggleHighlights: () => {},
          onTogglePanel: () => {},
          panelOpen: false,
        }),
      ).textContent
    expect(countText(0)).toContain('0 flags')
    expect(countText(1)).toContain('1 flag')
    expect(countText(1)).not.toContain('1 flags')
    expect(countText(2)).toContain('2 flags')
  })

  it('shows a dash and N/A when there is no score yet', () => {
    const container = mountFor(
      Badge({
        score: null,
        flagCount: 0,
        highlightsOn: false,
        onToggleHighlights: () => {},
        onTogglePanel: () => {},
        panelOpen: false,
      }),
    )
    expect(container.textContent).toContain('N/A')
  })

  it('calls onTogglePanel when the main pill is clicked', () => {
    const onTogglePanel = vi.fn()
    const container = mountFor(
      Badge({
        score,
        flagCount: 1,
        highlightsOn: false,
        onToggleHighlights: () => {},
        onTogglePanel,
        panelOpen: false,
      }),
    )
    const button = container.querySelector('.vf-badge-main') as HTMLButtonElement
    button.click()
    expect(onTogglePanel).toHaveBeenCalledOnce()
  })

  it('calls onToggleHighlights when the eye button is clicked', () => {
    const onToggleHighlights = vi.fn()
    const container = mountFor(
      Badge({
        score,
        flagCount: 1,
        highlightsOn: false,
        onToggleHighlights,
        onTogglePanel: () => {},
        panelOpen: false,
      }),
    )
    const button = container.querySelector('.vf-badge-toggle') as HTMLButtonElement
    button.click()
    expect(onToggleHighlights).toHaveBeenCalledOnce()
  })
})

describe('FlagPanel', () => {
  it('shows a friendly empty state when there are no flags', () => {
    const container = mountFor(FlagPanel({ flags: [], onSelectFlag: () => {} }))
    expect(container.textContent).toContain('No flags')
  })

  it('groups flags by rule and shows each group once', () => {
    const flags: Flag[] = [
      baseFlag,
      { ...baseFlag, hash: 'hash-2', text: 'utilize', blockId: 'block-2' },
      { ...baseFlag, ruleId: 'robust', hash: 'hash-3', text: 'robust', message: '"robust"' },
    ]
    const container = mountFor(FlagPanel({ flags, onSelectFlag: () => {} }))
    const groups = container.querySelectorAll('.vf-panel-group')
    expect(groups).toHaveLength(2)
    const utilizeCount = container.querySelector('.vf-panel-group-count')
    expect(utilizeCount?.textContent).toBe('2')
  })

  it('calls onSelectFlag with the right flag when an item is clicked', () => {
    const onSelectFlag = vi.fn()
    const container = mountFor(FlagPanel({ flags: [baseFlag], onSelectFlag }))
    const item = container.querySelector('.vf-panel-item') as HTMLButtonElement
    item.click()
    expect(onSelectFlag).toHaveBeenCalledWith(baseFlag)
  })
})

describe('FlagPopover', () => {
  const noop = () => {}

  it('shows a Manual fix button and Quick fix when the flag is editable and has a mechanical fix', () => {
    const flagWithFix: Flag = { ...baseFlag, fix: [{ start: 3, end: 11, text: 'use' }] }
    const container = mountFor(
      h(FlagPopover, {
        flag: flagWithFix,
        editable: true,
        onEdit: noop,
        onApplyFix: noop,
        onApplySuggestion: noop,
        onIgnore: noop,
        onOpenInEditor: noop,
        onClose: noop,
      }),
    )
    expect(container.textContent).toContain('Manual fix')
    expect(container.textContent).toContain('Quick fix')
  })

  it('shows only Manual fix (no Quick fix) when the flag is editable but has no mechanical fix', () => {
    const container = mountFor(
      h(FlagPopover, {
        flag: baseFlag,
        editable: true,
        onEdit: noop,
        onApplyFix: noop,
        onApplySuggestion: noop,
        onIgnore: noop,
        onOpenInEditor: noop,
        onClose: noop,
      }),
    )
    expect(container.textContent).toContain('Manual fix')
    expect(container.textContent).not.toContain('Quick fix')
  })

  it('shows a lock explanation and no Edit button when not editable', () => {
    const container = mountFor(
      h(FlagPopover, {
        flag: baseFlag,
        editable: false,
        lockReason: 'map',
        onEdit: noop,
        onApplyFix: noop,
        onApplySuggestion: noop,
        onIgnore: noop,
        onOpenInEditor: noop,
        onClose: noop,
      }),
    )
    expect(container.querySelector('.vf-popover-action-primary')).toBeNull()
    expect(container.textContent).toContain('.map()')
  })

  it('calls onIgnore when the Ignore button is clicked', () => {
    const onIgnore = vi.fn()
    const container = mountFor(
      h(FlagPopover, {
        flag: baseFlag,
        editable: true,
        onEdit: noop,
        onApplyFix: noop,
        onApplySuggestion: noop,
        onIgnore,
        onOpenInEditor: noop,
        onClose: noop,
      }),
    )
    const buttons = Array.from(container.querySelectorAll('.vf-popover-action'))
    const ignoreButton = buttons.find((b) => b.textContent === 'Ignore') as HTMLButtonElement
    ignoreButton.click()
    expect(onIgnore).toHaveBeenCalledOnce()
  })

  it('renders a suggestion button per suggestion and calls back with its label and index', () => {
    const onApplySuggestion = vi.fn()
    const flagWithSuggestions: Flag = {
      ...baseFlag,
      suggestions: [
        { label: 'comma', edits: [] },
        { label: 'period', edits: [] },
      ],
    }
    const container = mountFor(
      h(FlagPopover, {
        flag: flagWithSuggestions,
        editable: true,
        onEdit: noop,
        onApplyFix: noop,
        onApplySuggestion,
        onIgnore: noop,
        onOpenInEditor: noop,
        onClose: noop,
      }),
    )
    const buttons = Array.from(container.querySelectorAll('.vf-popover-action'))
    const periodButton = buttons.find((b) => b.textContent === 'period') as HTMLButtonElement
    periodButton.click()
    expect(onApplySuggestion).toHaveBeenCalledWith('period', 1)
  })
})
