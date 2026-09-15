/**
 * The corner pill: score, grade, and flag count. Click (or Alt+Shift+V, handled by the caller)
 * toggles underline highlights, which are off by default so the overlay never obscures a page a
 * developer hasn't asked to inspect yet.
 */

import type { Score } from '@voxfold/core'

export interface BadgeProps {
  score: Score | null
  flagCount: number
  highlightsOn: boolean
  onToggleHighlights: () => void
  onTogglePanel: () => void
  panelOpen: boolean
  dragHandleProps?: Record<string, unknown>
}

function gradeColor(grade: Score['grade'] | undefined): string {
  switch (grade) {
    case 'A':
      return '#16a34a'
    case 'B':
      return '#65a30d'
    case 'C':
      return '#ca8a04'
    case 'D':
      return '#ea580c'
    case 'F':
      return '#dc2626'
    default:
      return '#64748b'
  }
}

export function Badge(props: BadgeProps) {
  const { score, flagCount, highlightsOn, onToggleHighlights, onTogglePanel, panelOpen } = props

  return (
    <div class="vf-badge" {...(props.dragHandleProps ?? {})}>
      <button
        type="button"
        class="vf-badge-main"
        onClick={onTogglePanel}
        aria-expanded={panelOpen}
        aria-label="Toggle Voxfold flag panel"
      >
        <span class="vf-badge-grade" style={{ color: gradeColor(score?.grade) }}>
          {score ? score.grade : '—'}
        </span>
        <span class="vf-badge-score">{score ? score.value : 'N/A'}</span>
        <span class="vf-badge-count">{flagCount} flags</span>
      </button>
      <button
        type="button"
        class="vf-badge-toggle"
        aria-pressed={highlightsOn}
        title={highlightsOn ? 'Hide underlines (Alt+Shift+V)' : 'Show underlines (Alt+Shift+V)'}
        onClick={onToggleHighlights}
      >
        {highlightsOn ? '👁' : '👁‍🗨'}
      </button>
    </div>
  )
}
