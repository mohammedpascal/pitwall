import { useState } from 'react'
import type { Task, TaskStatus } from '#/server/types'
import { ago } from '#/lib/format'
import { ConsoleIcon, MailIcon, TerminalIcon, sourceIcon } from './icons'

type Filter = 'inbox' | 'approved' | 'all'

const CHIP: Record<TaskStatus, { label: string; dot: string; cls: string }> = {
  new: { label: 'New', dot: 'bg-ink', cls: 'bg-line-soft' },
  approved: { label: 'Approved', dot: 'bg-ok', cls: 'bg-line-soft' },
  rejected: { label: 'Rejected', dot: 'bg-ink-faint', cls: 'border border-line text-ink-soft' },
}

export function TaskSidebar({
  projectName,
  tasks,
  now,
  onAdd,
  onSetStatus,
}: {
  projectName: string
  tasks: Task[]
  now: number
  onAdd: (title: string) => Promise<void>
  onSetStatus: (id: string, status: TaskStatus) => void
}) {
  const [draft, setDraft] = useState('')
  const [filter, setFilter] = useState<Filter>('inbox')
  const [saving, setSaving] = useState(false)

  const counts = {
    inbox: tasks.filter((t) => t.status === 'new').length,
    approved: tasks.filter((t) => t.status === 'approved').length,
    all: tasks.length,
  }
  const visible = tasks.filter((t) =>
    filter === 'inbox' ? t.status === 'new' : filter === 'approved' ? t.status === 'approved' : true,
  )

  async function submit() {
    const title = draft.trim()
    if (!title || saving) return
    setSaving(true)
    try {
      await onAdd(title)
      setDraft('')
      setFilter('inbox')
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside
      aria-labelledby="tasks-h"
      className="flex max-w-full flex-[1_1_340px] flex-col gap-5 border-l border-line bg-surface px-[22px] py-7"
    >
      <h2 id="tasks-h" className="text-lg font-semibold">
        Tasks
      </h2>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="flex flex-col gap-2 rounded-[14px] border border-line bg-bg p-3"
      >
        <label htmlFor="new-task" className="text-xs font-semibold text-ink-soft">
          New task
        </label>
        <textarea
          id="new-task"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={`Describe what you want done in ${projectName}…`}
          className="resize-y bg-transparent p-0 text-sm leading-normal outline-none placeholder:text-ink-faint"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-soft">⌘↵ to add</span>
          <button
            type="submit"
            disabled={!draft.trim() || saving}
            className="h-9 rounded-lg bg-ink px-3.5 text-[13px] font-medium text-white hover:bg-ink/85 disabled:opacity-40"
          >
            Add task
          </button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
        <span className="mr-0.5">Also arriving from</span>
        <Pill icon={<TerminalIcon size={12} />} label="Terminal" />
        <Pill icon={<MailIcon size={12} />} label="Email · soon" muted />
        <Pill icon={<ConsoleIcon size={12} />} label="Console · soon" muted />
      </div>

      <div role="tablist" aria-label="Task filter" className="flex gap-1 rounded-[10px] bg-line-soft p-[3px]">
        {(
          [
            ['inbox', 'Inbox'],
            ['approved', 'Approved'],
            ['all', 'All'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            onClick={() => setFilter(id)}
            className={`h-[34px] flex-1 rounded-lg text-[13px] font-medium ${
              filter === id ? 'bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : ''
            }`}
          >
            {label} <span className="text-ink-soft">{counts[id]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        {visible.length === 0 && (
          <div className="rounded-[14px] border border-dashed border-line px-3 py-7 text-center text-[13px] text-ink-soft">
            {filter === 'inbox' ? 'Inbox is clear.' : 'Nothing here yet.'}
          </div>
        )}
        {visible.map((t) => {
          const Icon = sourceIcon[t.source]
          const chip = CHIP[t.status]
          return (
            <article key={t.id} className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-3.5">
              <div className="flex items-center justify-between gap-2 text-xs text-ink-soft">
                <span className="inline-flex items-center gap-1.5">
                  <Icon />
                  {t.sourceLabel}
                </span>
                <span>{ago(t.createdAt, now)}</span>
              </div>
              <div className="text-sm leading-snug font-medium break-words">{t.title}</div>
              {t.detail && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-ink-soft">Output</summary>
                  <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-bg p-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">
                    {t.detail}
                  </pre>
                </details>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${chip.cls}`}>
                  <span aria-hidden="true" className={`size-1.5 rounded-full ${chip.dot}`} />
                  {chip.label}
                </span>
                {t.status === 'new' ? (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => onSetStatus(t.id, 'rejected')}
                      className="h-9 rounded-lg border border-line px-3 text-[13px] font-medium hover:bg-line-soft"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => onSetStatus(t.id, 'approved')}
                      className="h-9 rounded-lg bg-ink px-3 text-[13px] font-medium text-white hover:bg-ink/85"
                    >
                      Approve
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSetStatus(t.id, 'new')}
                    className="h-9 rounded-lg px-2 text-[13px] text-ink-soft hover:bg-line-soft"
                  >
                    Move to inbox
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </aside>
  )
}

function Pill({ icon, label, muted }: { icon: React.ReactNode; label: string; muted?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 ${
        muted ? 'border-dashed border-line text-ink-soft' : 'border-line'
      }`}
    >
      {icon}
      {label}
    </span>
  )
}
