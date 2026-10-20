import { useState } from 'react'
import type { AttachmentUpload, Task, TaskStart } from '#/server/types'
import { ago } from '#/lib/format'
import { STAGE, askingLabel, byAttention, isClosed, waitsOnYou } from '#/lib/stages'
import { ArrowUpIcon, PaperclipIcon, PlusIcon, sourceIcon } from './icons'
import { AttachButton, AttachmentChips, useAttachments } from './Attachments'
import { MODE, ModePicker, useMode } from './ModePicker'
import { ModelPicker, useModel } from './ModelPicker'
import { SkillSuggest, useSkillSuggest } from './SkillSuggest'
import type { Skill } from '#/server/tools'
import type { ModelChoice } from '#/lib/models'

export function TaskSidebar({
  projectName,
  skills = [],
  tasks,
  now,
  selected,
  onAdd,
  onOpen,
  onAction,
  onReopen,
}: {
  projectName: string
  /** Offered when a task starts with "/". */
  skills?: Skill[]
  tasks: Task[]
  now: number
  selected: string | null
  /** Resolves true once the task is added. */
  onAdd: (title: string, attachments: AttachmentUpload[], how: TaskStart, model: ModelChoice) => Promise<boolean>
  onOpen: (task: Task) => void
  /** The card's one button: Plan (or Do it), Review plan or Check it. */
  onAction: (task: Task) => void
  onReopen: (task: Task) => void
}) {
  const open = tasks.filter((t) => !isClosed(t)).sort(byAttention)
  const closed = tasks.filter(isClosed)
  const yours = open.filter(waitsOnYou).length

  return (
    <aside
      aria-labelledby="tasks-h"
      className="flex max-w-full flex-[1_1_400px] flex-col gap-4 border-l border-line bg-surface px-[22px] py-7"
    >
      <h2 id="tasks-h" className="flex items-baseline gap-2 text-lg font-semibold">
        Needs you
        {yours > 0 && <span className="text-[15px] font-medium text-ink-soft">{yours}</span>}
      </h2>

      <div className="flex flex-col gap-2.5">
        {open.length === 0 && (
          <p className="rounded-[14px] border border-dashed border-line px-3 py-6 text-center text-[13px] leading-relaxed text-ink-soft">
            Nothing needs you. Crashes and tasks you add show up here, and Claude reads each one.
          </p>
        )}
        {open.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            now={now}
            selected={t.id === selected}
            onOpen={() => onOpen(t)}
            onAction={() => onAction(t)}
          />
        ))}
      </div>

      <AddTask projectName={projectName} skills={skills} onAdd={onAdd} />

      {closed.length > 0 && (
        <details className="group mt-2 border-t border-line-soft pt-4">
          <summary className="flex list-none items-center gap-1.5 text-[13px] font-semibold text-ink-soft select-none [&::-webkit-details-marker]:hidden">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="transition-transform group-open:rotate-90">
              <path d="M9 18l6-6-6-6" />
            </svg>
            Done {closed.length}
          </summary>
          <ul className="mt-3 flex flex-col">
            {closed.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-1.5">
                <button type="button" onClick={() => onOpen(t)} className="flex min-w-0 flex-col text-left">
                  <span className="truncate text-[13px] text-ink-soft line-through decoration-ink-faint">{t.title}</span>
                  {t.closedReason && <span className="truncate text-xs text-ink-faint">{t.closedReason}</span>}
                </button>
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

function TaskCard({
  task: t,
  now,
  selected,
  onOpen,
  onAction,
}: {
  task: Task
  now: number
  selected: boolean
  onOpen: () => void
  onAction: () => void
}) {
  const Icon = sourceIcon[t.source]
  const count = t.count ?? 1
  const stage = STAGE[t.stage]
  const auto = t.sourceLabel !== 'You' && !t.parentId
  // A simple task needs no plan, so its button does it. A question from Claude comes first.
  const action = t.asking ? 'Answer' : t.stage === 'ready' && t.simple ? 'Do it' : stage.action
  return (
    <article
      onClick={onOpen}
      className={`flex cursor-pointer flex-col gap-2.5 rounded-[14px] border bg-surface p-3.5 ${
        selected ? 'border-ink' : 'border-line hover:border-ink-faint'
      }`}
    >
      {/* Where it came from, only when it wasn't you: a crash, a sync. */}
      {auto && (
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-xs text-ink-soft">
          <Icon />
          {t.sourceLabel}
        </span>
      )}
      <button type="button" onClick={onOpen} className="text-left text-sm leading-snug font-medium break-words">
        {t.title}
        {count > 1 && (
          <span className="ml-1.5 inline-flex rounded-full bg-line-soft px-1.5 py-0.5 align-middle text-[11px] font-semibold text-ink-soft">
            ×{count}
          </span>
        )}
      </button>
      {t.error && <p className="text-xs leading-snug text-err">{t.error}</p>}
      <div className="flex items-center justify-between gap-2">
        {/* When, and what's going on only when no button already says it. */}
        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-soft">
          {ago(t.lastSeenAt ?? t.createdAt, now)}
          {t.attachments?.length ? (
            <span className="inline-flex items-center gap-0.5" title={`${t.attachments.length} attached`}>
              <PaperclipIcon size={12} />
              {t.attachments.length}
            </span>
          ) : null}
          {t.asking ? (
            <>
              <span aria-hidden="true">·</span>
              <span aria-hidden="true" className="size-1.5 flex-none rounded-full bg-warn" />
              <span className="truncate font-medium text-ink">{askingLabel(t.asking.tool)}</span>
            </>
          ) : (
            !action && (
              <>
                <span aria-hidden="true">·</span>
                {stage.working && <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-ink-soft" />}
                <span className={stage.working ? '' : 'font-medium text-ink'}>{stage.label}</span>
              </>
            )
          )}
        </span>
        {action && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onAction()
            }}
            className="h-9 flex-none rounded-lg bg-ink px-3 text-[13px] font-medium text-white hover:bg-ink/85"
          >
            {action}
          </button>
        )}
      </div>
    </article>
  )
}

function AddTask({
  projectName,
  skills,
  onAdd,
}: {
  projectName: string
  skills: Skill[]
  onAdd: (title: string, attachments: AttachmentUpload[], how: TaskStart, model: ModelChoice) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useMode('pitwall.addMode', 'read')
  const [model, setModel] = useModel('pitwall.model')
  const [draft, setDraft] = useState('')
  const suggest = useSkillSuggest(draft, skills, setDraft)
  const { files, problem, setProblem, addFiles: add, removeFile, clear, uploads } = useAttachments()
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)

  function addFiles(list: FileList | File[]) {
    add(list)
    setOpen(true)
  }

  function reset() {
    clear()
    setDraft('')
    setOpen(false)
  }

  async function submit() {
    const title = draft.trim()
    if ((!title && !files.length) || saving) return
    setSaving(true)
    try {
      if (await onAdd(title, await uploads(), mode, model)) reset()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
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
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setDragging(false)
        addFiles(e.dataTransfer.files)
      }}
      className={`flex flex-col gap-2 rounded-[14px] border bg-surface p-3 ${
        dragging ? 'border-dashed border-ink bg-line-soft' : 'border-ink'
      }`}
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
        onPaste={(e) => {
          // A pasted screenshot becomes an attachment; pasted text stays text.
          if (e.clipboardData.files.length) {
            e.preventDefault()
            addFiles(e.clipboardData.files)
          }
        }}
        onKeyDown={(e) => {
          // Typing "/" offers skills; picking one comes before adding the task.
          if (suggest.onKeyDown(e)) return
          // Enter adds it, like a chat box; Shift+Enter starts a new line.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          } else if (e.key === 'Escape') {
            reset()
          }
        }}
        placeholder={dragging ? 'Drop to attach' : `What needs doing in ${projectName}?`}
        className="resize-y bg-transparent text-sm leading-normal outline-none placeholder:text-ink-faint"
      />
      <SkillSuggest {...suggest} />

      <AttachmentChips files={files} onRemove={removeFile} />
      {problem && (
        <p role="alert" className="text-xs text-err">
          {problem}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <AttachButton onPick={addFiles} />
        {/* How it runs and the send button sit together on the right, like a chat box. */}
        <span className="ml-auto flex items-center gap-1.5">
          <ModelPicker model={model} onPick={setModel} />
          <ModePicker mode={mode} onPick={setMode} />
          <button
            type="submit"
            disabled={(!draft.trim() && !files.length) || saving}
            aria-label={saving ? 'Adding…' : MODE[mode].button}
            title={MODE[mode].button}
            className="flex size-9 items-center justify-center rounded-full bg-ink text-white hover:bg-ink/85 disabled:opacity-40"
          >
            <ArrowUpIcon className={saving ? 'animate-pulse' : undefined} />
          </button>
        </span>
      </div>
    </form>
  )
}
