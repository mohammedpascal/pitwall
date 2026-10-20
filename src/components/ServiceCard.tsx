import { useRef, useState } from 'react'
import type { ServiceStatus, ServiceView } from '#/server/types'
import { Menu } from './Menu'

export const STATUS: Record<ServiceStatus, { dot: string; action: 'Start' | 'Stop' | 'Restart' }> = {
  running: { dot: 'bg-ok', action: 'Stop' },
  starting: { dot: 'bg-warn', action: 'Stop' },
  stopped: { dot: 'border-[1.5px] border-ink-faint', action: 'Start' },
  error: { dot: 'bg-err', action: 'Restart' },
}

type Editing = 'command' | null

/** One service, as a tab on the output panel: its dot, its name and what it's doing if that needs you. */
export function ServiceTab({
  service: s,
  selected,
  onSelect,
}: {
  service: ServiceView
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      title={`$ ${s.command}`}
      className={`relative flex h-10 flex-none items-center gap-2 rounded-t-xl px-4 text-[13px] font-semibold ${
        selected ? 'z-10 -mb-px border border-b-0 border-line bg-surface text-ink' : 'text-ink-soft hover:bg-line-soft hover:text-ink'
      }`}
    >
      <span aria-hidden="true" className={`size-[9px] flex-none rounded-full ${STATUS[s.status].dot}`} />
      <span className="max-w-[160px] truncate">{s.name}</span>
      <StatusLine service={s} />
    </button>
  )
}

/** The shown service's own controls, at the end of the panel's toolbar. */
export function ServiceActions({
  service: s,
  busy,
  onToggle,
  onSave,
  onRemove,
}: {
  service: ServiceView
  busy: boolean
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
    setDraft(s.command)
    setEditing(field)
  }

  async function commit() {
    const value = draft.trim()
    const field = editingRef.current
    setEditing(null)
    if (!field || !value || value === s.command) return
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

  return (
    <div className="relative flex flex-none items-center gap-0.5">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        className="h-8 rounded-lg px-2.5 text-xs font-semibold text-ink hover:bg-line-soft disabled:opacity-50"
      >
        {look.action}
      </button>
      <Menu
        label={`${s.name} options`}
        items={[
          { label: 'Edit command', onSelect: () => edit('command') },
          { label: 'Remove service', onSelect: onRemove, danger: true },
        ]}
      />

      {editing === 'command' && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-full right-0 z-20 mt-2 flex w-[min(420px,90vw)] flex-col gap-2 rounded-xl border border-line bg-surface p-3 shadow-[0_12px_32px_rgba(0,0,0,0.12)]"
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
function StatusLine({ service: s }: { service: ServiceView }) {
  // The hollow dot already says stopped.
  if (s.status === 'running' || s.status === 'stopped') return null
  const text = s.status === 'starting' ? 'Starting…' : 'Crashed'
  return <span className={`text-xs whitespace-nowrap ${s.status === 'error' ? 'font-medium text-err' : 'font-normal text-ink-soft'}`}>{text}</span>
}
