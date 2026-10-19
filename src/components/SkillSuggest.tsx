import { useState, type KeyboardEvent } from 'react'
import type { Skill } from '#/server/tools'

/** While the text is just "/" and a partial name: the skills it could be, newest keystroke first. */
export function useSkillSuggest(text: string, skills: Skill[], setText: (t: string) => void) {
  const [active, setActive] = useState(0)
  const [closedFor, setClosedFor] = useState<string | null>(null)
  const typed = /^\/(\S*)$/.exec(text)?.[1]
  const matches =
    typed === undefined || closedFor === text
      ? []
      : skills.filter((s) => s.name.toLowerCase().includes(typed.toLowerCase())).slice(0, 6)
  const at = Math.min(active, Math.max(0, matches.length - 1))

  const pick = (s: Skill) => {
    setText(`/${s.name} `)
    setActive(0)
  }

  /** Arrows, Enter and Tab pick; Esc closes. True when it handled the key, so the box shouldn't. */
  function onKeyDown(e: KeyboardEvent) {
    if (!matches.length) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((at + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
      return true
    }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault()
      pick(matches[at])
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setClosedFor(text)
      return true
    }
    return false
  }

  return { matches, at, pick, onKeyDown }
}

/** The list under the task box. */
export function SkillSuggest({ matches, at, pick }: { matches: Skill[]; at: number; pick: (s: Skill) => void }) {
  if (!matches.length) return null
  return (
    <ul role="listbox" aria-label="Skills" className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
      {matches.map((s, i) => (
        <li key={s.name} role="option" aria-selected={i === at}>
          <button
            type="button"
            // Keeps focus in the box, so typing carries on.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(s)}
            className={`flex w-full flex-col px-3 py-2 text-left ${i === at ? 'bg-line-soft' : 'hover:bg-line-soft'}`}
          >
            <span className="font-mono text-[13px] font-semibold">/{s.name}</span>
            {s.description && <span className="line-clamp-1 text-xs text-ink-soft">{s.description}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}
