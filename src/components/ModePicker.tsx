import { useEffect, useState } from 'react'
import type { TaskStart } from '#/server/types'
import { Menu } from './Menu'

/** How far a new task goes: the picker's label, the button it sets, and what it means. */
export const MODE: Record<TaskStart, { label: string; button: string; hint: string }> = {
  read: { label: 'Clarify', button: 'Add', hint: 'Read it, then wait for you' },
  plan: { label: 'Plan', button: 'Plan', hint: 'Plan it straight away' },
  do: { label: 'Build', button: 'Build', hint: 'Make the change now' },
}

const MODES = Object.keys(MODE) as TaskStart[]

/** The mode last picked in this box, remembered in this browser. */
export function useMode(key: string, fallback: TaskStart) {
  const [mode, setMode] = useState<TaskStart>(fallback)
  // Read after mounting, so the server's render and the first browser render match.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key)
      if (saved && saved in MODE) setMode(saved as TaskStart)
    } catch {
      // Storage blocked: stay on the default.
    }
  }, [key])
  function pick(m: TaskStart) {
    setMode(m)
    try {
      localStorage.setItem(key, m)
    } catch {
      // Not remembered; it still applies now.
    }
  }
  return [mode, pick] as const
}

/**
 * After a pick the menu hands focus back to its button, so Enter would just reopen it.
 * Move on to the send button beside it instead, or to the text box while there's nothing to send.
 */
function sendNext() {
  const opener = document.activeElement as HTMLElement | null
  const send = opener?.parentElement?.nextElementSibling
  if (send instanceof HTMLButtonElement && !send.disabled) send.focus()
  else opener?.closest('form')?.querySelector('textarea')?.focus()
}

/** Sits before the action button and decides what it does. */
export function ModePicker({ mode, onPick }: { mode: TaskStart; onPick: (m: TaskStart) => void }) {
  return (
    <Menu
      label="Mode"
      trigger={
        <>
          {MODE[mode].label}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-ink-soft">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </>
      }
      items={MODES.map((m) => ({
        label: MODE[m].label,
        hint: MODE[m].hint,
        checked: m === mode,
        onSelect: () => {
          onPick(m)
          sendNext()
        },
      }))}
    />
  )
}
