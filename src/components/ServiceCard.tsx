import { useRef, useState } from 'react'
import type { ServiceStatus, ServiceView } from '#/server/types'
import { duration } from '#/lib/format'
import { ExternalIcon } from './icons'
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
  now,
  onSelect,
  onToggle,
  onSave,
  onRemove,
}: {
  service: ServiceView
  selected: boolean
  now: number
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

  return (
    <div
      onClick={onSelect}
      className={`flex cursor-default flex-col gap-2 rounded-2xl border-[1.5px] bg-surface p-4 ${selected ? 'border-ink' : 'border-line hover:border-ink-faint'}`}
    >
      <div className="flex min-h-8 items-center justify-between gap-2">
        {editing === 'name' ? (
          <input
            aria-label="Service name"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={keys}
            onBlur={() => void commit()}
            className="h-8 min-w-0 flex-1 rounded-lg border border-ink bg-surface px-2 text-base font-semibold outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={onSelect}
            title={`$ ${s.command}`}
            aria-label={`Show ${s.name} output`}
            aria-pressed={selected}
            className="flex min-w-0 items-center gap-2.5 text-base font-semibold"
          >
            <span aria-hidden="true" className={`size-[9px] flex-none rounded-full ${look.dot}`} />
            <span className="truncate">{s.name}</span>
          </button>
        )}
        <Menu
          label={`${s.name} options`}
          size="sm"
          items={[
            { label: look.action, onSelect: onToggle },
            { label: 'Edit command', onSelect: () => edit('command') },
            { label: 'Rename', onSelect: () => edit('name') },
            { label: 'Remove service', onSelect: onRemove, danger: true },
          ]}
        />
      </div>

      {editing === 'command' ? (
        <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
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
      ) : (
        <div className="flex min-h-6 items-center">
          {s.qr ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onSelect()
              }}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium hover:underline"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <path d="M14 14h3v3M21 14v.01M14 21h7v-4" />
              </svg>
              Scan to open
            </button>
          ) : (
            <StatusLine service={s} now={now} />
          )}
        </div>
      )}
    </div>
  )
}

function StatusLine({ service: s, now }: { service: ServiceView; now: number }) {
  if (s.status === 'running' && s.url) {
    return (
      <a
        href={s.url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-xs hover:underline"
      >
        <span className="truncate">{s.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
        <ExternalIcon />
      </a>
    )
  }
  const text =
    s.status === 'running'
      ? s.startedAt
        ? `Up ${duration(now - s.startedAt)}`
        : 'Running'
      : s.status === 'starting'
        ? 'Starting…'
        : s.status === 'error'
          ? 'Crashed'
          : 'Stopped'
  return <span className={`text-[13px] ${s.status === 'error' ? 'font-medium text-err' : 'text-ink-soft'}`}>{text}</span>
}
