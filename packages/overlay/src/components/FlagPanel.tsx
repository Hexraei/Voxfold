/**
 * The badge's expanded panel: every current flag, grouped by rule. Clicking one scrolls its
 * highlighted text into view — the panel is the way to find a flag on a long page without hunting
 * through underlines by eye.
 */

import type { Flag } from '@voxfold/core'
import { colorForCategory } from '../highlight.ts'

export interface FlagPanelProps {
  flags: readonly Flag[]
  onSelectFlag: (flag: Flag) => void
  selectedFlagHash?: string | undefined
}

interface RuleGroup {
  ruleId: string
  category: string
  message: string
  flags: Flag[]
}

function groupByRule(flags: readonly Flag[]): RuleGroup[] {
  const groups = new Map<string, RuleGroup>()
  for (const flag of flags) {
    let group = groups.get(flag.ruleId)
    if (!group) {
      group = { ruleId: flag.ruleId, category: flag.category, message: flag.message, flags: [] }
      groups.set(flag.ruleId, group)
    }
    group.flags.push(flag)
  }
  return [...groups.values()].sort((a, b) => b.flags.length - a.flags.length)
}

export function FlagPanel(props: FlagPanelProps) {
  const { flags, onSelectFlag, selectedFlagHash } = props

  if (flags.length === 0) {
    return <div class="vf-panel vf-panel-empty">No flags on this page. Nice.</div>
  }

  const groups = groupByRule(flags)

  return (
    <div class="vf-panel">
      {groups.map((group) => (
        <div class="vf-panel-group" key={group.ruleId}>
          <div class="vf-panel-group-header">
            <span
              class="vf-panel-dot"
              style={{ backgroundColor: colorForCategory(group.category) }}
            />
            <span class="vf-panel-group-title">{group.message}</span>
            <span class="vf-panel-group-count">{group.flags.length}</span>
          </div>
          <ul class="vf-panel-list">
            {group.flags.map((flag) => (
              <li key={flag.hash}>
                <button
                  type="button"
                  class={
                    flag.hash === selectedFlagHash
                      ? 'vf-panel-item vf-panel-item-selected'
                      : 'vf-panel-item'
                  }
                  onClick={() => onSelectFlag(flag)}
                >
                  “{flag.text}”
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
