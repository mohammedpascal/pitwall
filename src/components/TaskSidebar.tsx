import { useState } from 'react'
import type { Task } from '#/server/types'
import { ago } from '#/lib/format'
import { PlusIcon, sourceIcon } from './icons'

export function TaskSidebar({
  projectName,
  tasks,
  now,
  onAdd,
  onDone,
  onReopen,
}: {
  projectName: string
  tasks: Task[]
  now: number
  onAdd: (title: string) => Promise<void>
  onDone: (task: Task) => void
  onReopen: (task: Task) => void
}) {
  const open = tasks.filter((t) => t.status === 'open')
  const done = tasks.filter((t) => t.status === 'done')

  return (
    <aside
      aria-labelledby="tasks-h"
      className="flex max-w-full flex-[1_1_340px] flex-col gap-4 border-l border-line bg-surface px-[22px] py-7"
    >
      <h2 id="tasks-h" className="flex items-baseline gap-2 text-lg font-semibold">
        Needs you
        {open.length > 0 && <span className="text-[15px] font-medium text-ink-soft">{open.length}</span>}
      </h2>

      <div className="flex flex-col gap-2.5">
        {open.length === 0 && (
          <p className="rounded-[14px] border border-dashed border-line px-3 py-6 text-center text-[13px] leading-relaxed text-ink-soft">
            Nothing needs you. When a service crashes, it shows up here.
          </p>
        )}
        {open.map((t) => (
          <TaskCard key={t.id} task={t} now={now} onDone={() => onDone(t)} />
        ))}
      </div>

      <AddTask projectName={projectName} onAdd={onAdd} />

      {done.length > 0 && (
        <details className="group mt-2 border-t border-line-soft pt-4">
          <summary className="flex list-none items-center gap-1.5 text-[13px] font-semibold text-ink-soft select-none [&::-webkit-details-marker]:hidden">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="transition-transform group-open:rotate-90">
              <path d="M9 18l6-6-6-6" />
            </svg>
            Done {done.length}
          </summary>
          <ul className="mt-3 flex flex-col">
            {done.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-[13px] text-ink-soft line-through decoration-ink-faint">{t.title}</span>
                <button
                  type="button"
                  onClick={() => onReopen(t)}
                  className="h-8 flex-none rounded-lg px-2 text-xs font-medium text-ink-soft hover:bg-line-soft hover:text-ink"
                >
                  Reopen
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  )
}

function TaskCard({ task: t, now, onDone }: { task: Task; now: number; onDone: () => void }) {
  const Icon = sourceIcon[t.source]
  const count = t.count ?? 1
  return (
    <article className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-3.5">
      <div className="flex items-center justify-between gap-2 text-xs text-ink-soft">
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
          <Icon />
          {t.sourceLabel}
        </span>
        <span className="flex-none">{ago(t.lastSeenAt ?? t.createdAt, now)}</span>
      </div>
      <div className="text-sm leading-snug font-medium break-words">
        {t.title}
        {count > 1 && (
          <span className="ml-1.5 inline-flex rounded-full bg-line-soft px-1.5 py-0.5 align-middle text-[11px] font-semibold text-ink-soft">
            ×{count}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        {t.detail ? (
          <details className="min-w-0 flex-1 text-xs">
            <summary className="text-ink-soft">Output</summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-bg p-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">
              {t.detail}
            </pre>
          </details>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onDone}
          className="h-9 flex-none self-start rounded-lg border border-line px-3 text-[13px] font-medium hover:bg-line-soft"
        >
          Done
        </button>
      </div>
    </article>
  )
}

function AddTask({ projectName, onAdd }: { projectName: string; onAdd: (title: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    const title = draft.trim()
    if (!title || saving) return
    setSaving(true)
    try {
      await onAdd(title)
      setDraft('')
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 self-start rounded-[10px] px-2 font-medium text-ink-soft hover:bg-line-soft hover:text-ink"
      >
        <PlusIcon size={16} />
        Add a task
      </button>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="flex flex-col gap-2 rounded-[14px] border border-ink bg-surface p-3"
    >
      <label htmlFor="new-task" className="sr-only">
        New task
      </label>
      <textarea
        id="new-task"
        rows={3}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        placeholder={`What needs doing in ${projectName}?`}
        className="resize-y bg-transparent text-sm leading-normal outline-none placeholder:text-ink-faint"
      />
      <div className="flex items-center justify-end gap-1.5">
        <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-lg px-3 text-[13px] font-medium hover:bg-line-soft">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!draft.trim() || saving}
          className="h-9 rounded-lg bg-ink px-3.5 text-[13px] font-medium text-white hover:bg-ink/85 disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </form>
  )
}
