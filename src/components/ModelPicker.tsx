import { useEffect, useState } from 'react'
import { isModel, MODELS, type ModelChoice } from '#/lib/models'
import { Menu } from './Menu'

const CHOICES = Object.keys(MODELS) as ModelChoice[]

/** The model last picked in this box, remembered in this browser. */
export function useModel(key: string, fallback: ModelChoice = 'default') {
  const [model, setModel] = useState<ModelChoice>(fallback)
  // Read after mounting, so the server's render and the first browser render match.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key)
      if (isModel(saved)) setModel(saved)
    } catch {
      // Storage blocked: stay on the default.
    }
  }, [key])
  function pick(m: ModelChoice) {
    setModel(m)
    try {
      localStorage.setItem(key, m)
    } catch {
      // Not remembered; it still applies now.
    }
  }
  return [model, pick] as const
}

/** Sits beside the mode picker: which Claude does the task. */
export function ModelPicker({
  model,
  onPick,
  compact = false,
}: {
  model: ModelChoice
  onPick: (m: ModelChoice) => void
  /** Plain text in a line of other text, e.g. a task's "You · 2m ago · Opus". */
  compact?: boolean
}) {
  return (
    <Menu
      label="Model"
      triggerClassName={
        compact ? 'inline-flex items-center gap-0.5 rounded-md px-1 -mx-1 text-xs text-ink-soft hover:bg-line-soft hover:text-ink' : undefined
      }
      trigger={
        <>
          {MODELS[model].label}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-ink-soft">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </>
      }
      items={CHOICES.map((m) => ({
        label: MODELS[m].label,
        hint: MODELS[m].hint,
        checked: m === model,
        onSelect: () => onPick(m),
      }))}
    />
  )
}
