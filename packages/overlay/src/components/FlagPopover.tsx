/**
 * The popover that appears when a flag is clicked: what the rule caught, why, and what can be
 * done about it. Actions are gated on what the resolved DOM range actually allows — a locked
 * segment (a `.map()`, a bare variable, an inline expression) never offers "Edit," only an
 * explanation of why not.
 */

import type { Flag } from '@voxfold/core'

export interface FlagPopoverProps {
  flag: Flag
  editable: boolean
  lockReason?: string
  style?: Record<string, string>
  onEdit: () => void
  onApplyFix: () => void
  onApplySuggestion: (label: string, index: number) => void
  onIgnore: () => void
  onOpenInEditor: () => void
  onClose: () => void
}

const LOCK_EXPLANATIONS: Record<string, string> = {
  map: 'This text comes from a list rendered with .map() — edit the source data or template instead.',
  variable: 'This text comes from a variable, not a literal — edit where that variable is set.',
  expression: 'This text comes from an expression, not plain text.',
  'template-literal': 'This text comes from a template literal — edit the pieces it is built from.',
  i18n: 'This text comes from a translation string — edit it in your translation file.',
  'inline-tag': 'This is an embedded element (code, an image, a line break), not editable text.',
  'html-injection': 'This text is raw HTML, not plain prose.',
  import: 'This text comes from an imported value.',
  unknown: "This text can't be traced back to an editable source.",
}

export function FlagPopover(props: FlagPopoverProps) {
  const {
    flag,
    editable,
    lockReason,
    onEdit,
    onApplyFix,
    onApplySuggestion,
    onIgnore,
    onOpenInEditor,
    onClose,
  } = props

  return (
    <div class="vf-popover" style={props.style} role="dialog" aria-label={flag.message}>
      <div class="vf-popover-header">
        <span class="vf-popover-rule">{flag.ruleId}</span>
        <button type="button" class="vf-popover-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <p class="vf-popover-message">{flag.message}</p>
      {flag.docs ? <p class="vf-popover-docs">{flag.docs}</p> : null}

      <div class="vf-popover-actions">
        {editable && flag.fix ? (
          <button
            type="button"
            class="vf-popover-action vf-popover-action-primary"
            onClick={onApplyFix}
          >
            Apply fix
          </button>
        ) : null}
        {editable ? (
          <button type="button" class="vf-popover-action" onClick={onEdit}>
            Edit
          </button>
        ) : null}
        {flag.suggestions?.map((suggestion, index) => (
          <button
            type="button"
            class="vf-popover-action"
            key={suggestion.label}
            onClick={() => onApplySuggestion(suggestion.label, index)}
          >
            {suggestion.label}
          </button>
        ))}
        <button type="button" class="vf-popover-action" onClick={onIgnore}>
          Ignore
        </button>
        <button type="button" class="vf-popover-action" onClick={onOpenInEditor}>
          Open in editor
        </button>
      </div>

      {!editable ? (
        <p class="vf-popover-locked">
          {lockReason && lockReason in LOCK_EXPLANATIONS
            ? LOCK_EXPLANATIONS[lockReason]
            : "This text can't be edited here."}
        </p>
      ) : null}
    </div>
  )
}
