import { Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import type { ServiceStatus, ServiceView } from '#/server/types'
import { Menu } from './Menu'

export const STATUS: Record<ServiceStatus, { dot: string; action: 'Start' | 'Stop' | 'Restart' }> = {
  running: { dot: 'bg-ok', action: 'Stop' },
  starting: { dot: 'bg-warn', action: 'Stop' },
  stopped: { dot: 'border-[1.5px] border-ink-faint', action: 'Start' },
  error: { dot: 'bg-err', action: 'Restart' },
}

type Editing = 'name' | 'command' | null

export function ServiceCard({
  service: s,
  selected,
  onSelect,
  onToggle,
  onSave,
  onRemove,
}: {
  service: ServiceView
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onSave: (change: { name?: string; command?: string }) => Promise<void>
  onRemove: () => void
}) {
  const [editing, setEditingState] = useState<Editing>(null)
  const [draft, setDraft] = useState('')
  // Enter and blur can both fire for one edit; the ref makes sure it saves once.
  const editingRef = useRef<Editing>(null)
  const setEditing = (v: Editing) => {
    editingRef.current = v
    setEditingState(v)
  }
  const look = STATUS[s.status]

  function edit(field: Exclude<Editing, null>) {
    setDraft(field === 'name' ? s.name : s.command)
    setEditing(field)
  }

  async function commit() {
    const value = draft.trim()
    const field = editingRef.current
    setEditing(null)
    if (!field || !value || value === (field === 'name' ? s.name : s.command)) return
    await onSave({ [field]: value })
  }

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setEditing(null)
    }
  }

  // One pill per service: whose output shows is the filled one.
  const dots = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  )
  return (
    <div className="relative">
      <div
        onClick={onSelect}
        className={`flex h-9 cursor-default items-center gap-2 rounded-full border pr-1 pl-3 ${
          selected ? 'border-ink bg-ink text-white' : 'border-line bg-surface hover:border-ink-faint'
        }`}
      >
        {editing === 'name' ? (
          <input
            aria-label="Service name"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={keys}
            onBlur={() => void commit()}
            onClick={(e) => e.stopPropagation()}
            className="h-7 w-36 rounded-md border border-ink bg-surface px-2 text-[13px] font-semibold text-ink outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={onSelect}
            title={`$ ${s.command}`}
            aria-label={`Show ${s.name} output`}
            aria-pressed={selected}
            className="flex min-w-0 items-center gap-2 text-[13px] font-semibold"
          >
            <span aria-hidden="true" className={`size-[9px] flex-none rounded-full ${look.dot}`} />
            <span className="max-w-[160px] truncate">{s.name}</span>
          </button>
        )}
        {s.qr ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSelect()
            }}
            className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <path d="M14 14h3v3M21 14v.01M14 21h7v-4" />
            </svg>
            Scan
          </button>
        ) : (
          <StatusLine service={s} selected={selected} />
        )}
        <Menu
          label={`${s.name} options`}
          trigger={dots}
          triggerClassName={`flex size-7 items-center justify-center rounded-full ${
            selected ? 'text-white/80 hover:bg-white/15 hover:text-white' : 'text-ink-soft hover:bg-line-soft hover:text-ink'
          }`}
          items={[
            { label: look.action, onSelect: onToggle },
            { label: 'Edit command', onSelect: () => edit('command') },
            { label: 'Rename', onSelect: () => edit('name') },
            { label: 'Remove service', onSelect: onRemove, danger: true },
          ]}
        />
      </div>

      {editing === 'command' && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-full left-0 z-20 mt-2 flex w-[min(420px,90vw)] flex-col gap-2 rounded-xl border border-line bg-surface p-3 shadow-[0_12px_32px_rgba(0,0,0,0.12)]"
        >
          <input
            aria-label={`${s.name} command`}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={keys}
            spellCheck={false}
            className="h-9 rounded-lg border border-ink bg-bg px-2.5 font-mono text-xs outline-none"
          />
          <div className="flex items-center justify-between gap-2 text-xs text-ink-soft">
            <span>{s.status === 'running' ? 'Takes effect on restart.' : 'Enter to save · Esc to cancel'}</span>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setEditing(null)} className="h-8 rounded-lg px-2.5 font-medium hover:bg-line-soft">
                Cancel
              </button>
              <button type="button" onClick={() => void commit()} className="h-8 rounded-lg bg-ink px-3 font-medium text-white hover:bg-ink/85">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Only what changes what you'd do: a running service needs no words, its dot says it. */
function StatusLine({ service: s, selected }: { service: ServiceView; selected: boolean }) {
  if (s.status === 'running' && s.needsDomain) {
    return (
      <Link
        to="/setup"
        onClick={(e) => e.stopPropagation()}
        className={`text-xs font-medium whitespace-nowrap hover:underline ${selected ? 'text-white/80' : 'text-ink-soft hover:text-ink'}`}
      >
        Add a dev domain
      </Link>
    )
  }
  if (s.status === 'running') return null
  const text = s.status === 'starting' ? 'Starting…' : s.status === 'error' ? 'Crashed' : 'Stopped'
  const tone = s.status === 'error' ? (selected ? 'font-medium text-white' : 'font-medium text-err') : selected ? 'text-white/80' : 'text-ink-soft'
  return <span className={`text-xs whitespace-nowrap ${tone}`}>{text}</span>
}
