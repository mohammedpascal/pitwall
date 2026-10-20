import { useState } from 'react'
import type { AttachmentUpload, Task, TaskStart } from '#/server/types'
import { STAGE, askingLabel, byAttention, isClosed, waitsOnYou } from '#/lib/stages'
import { ArrowUpIcon, PlusIcon } from './icons'
import { AttachButton, AttachmentChips, useAttachments } from './Attachments'
import { MODE, ModePicker, useMode } from './ModePicker'
import { ModelPicker, useModel } from './ModelPicker'
import { SkillSuggest, useSkillSuggest } from './SkillSuggest'
import type { Skill } from '#/server/tools'
import type { ModelChoice } from '#/lib/models'

/** Tasks, floating bottom right: Done, then one line per open task, then the box to add one. */
export function TaskDock({
  projectName,
  skills = [],
  tasks,
  onAdd,
  onOpen,
  onAction,
  onReopen,
}: {
  projectName: string
  /** Offered when a task starts with "/". */
  skills?: Skill[]
  tasks: Task[]
  /** Resolves true once the task is added. */
  onAdd: (title: string, attachments: AttachmentUpload[], how: TaskStart, model: ModelChoice) => Promise<boolean>
  onOpen: (task: Task) => void
  /** The line's one button: Plan (or Do it), Review plan or Check it. */
  onAction: (task: Task) => void
  onReopen: (task: Task) => void
}) {
  const open = tasks.filter((t) => !isClosed(t)).sort(byAttention)
  const closed = tasks.filter(isClosed)

  return (
    <aside
      aria-label="Tasks"
      className="fixed right-4 bottom-4 z-30 flex max-h-[calc(100dvh-2rem)] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_16px_40px_rgba(0,0,0,0.14)]"
    >
      {closed.length > 0 && (
        <details className="group flex-none border-b border-line-soft">
          <summary className="flex h-10 list-none items-center gap-1.5 px-4 text-[13px] font-semibold text-ink-soft select-none hover:text-ink [&::-webkit-details-marker]:hidden">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="transition-transform group-open:rotate-90">
              <path d="M9 18l6-6-6-6" />
            </svg>
            Done {closed.length}
          </summary>
          <ul className="flex max-h-48 flex-col overflow-y-auto pb-1">
            {closed.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-1 pr-2 pl-[34px]">
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

      {open.length > 0 && (
        <ul className="min-h-0 flex-shrink overflow-y-auto">
          {open.map((t) => (
            <TaskLine key={t.id} task={t} onOpen={() => onOpen(t)} onAction={() => onAction(t)} />
          ))}
        </ul>
      )}

      <AddTask projectName={projectName} skills={skills} onAdd={onAdd} />
    </aside>
  )
}

/** One open task on one line: what state it's in, its title, and its one button. The rest is in the task. */
function TaskLine({ task: t, onOpen, onAction }: { task: Task; onOpen: () => void; onAction: () => void }) {
  const count = t.count ?? 1
  const stage = STAGE[t.stage]
  // A simple task needs no plan, so its button does it. A question from Claude comes first.
  const action = t.asking ? 'Answer' : t.stage === 'ready' && t.simple ? 'Do it' : stage.action
  const dot = t.error ? 'bg-err' : waitsOnYou(t) ? 'bg-warn' : stage.working ? 'animate-pulse bg-ink-soft' : 'bg-ink-faint'
  return (
    <li className="flex items-center gap-1 border-b border-line-soft pr-2 hover:bg-bg">
      <button
        type="button"
        onClick={onOpen}
        title={t.error ?? t.title}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 py-2 pr-1.5 pl-4 text-left text-[13.5px] font-medium"
      >
        <span aria-hidden="true" className={`size-2 flex-none rounded-full ${dot}`} />
        <span className="min-w-0 flex-1 truncate">{t.title}</span>
        {count > 1 && (
          <span className="flex-none rounded-full bg-line-soft px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft">×{count}</span>
        )}
        {/* What's going on, only when no button already says it. */}
        {t.asking ? (
          <span className="flex-none text-xs text-ink">{askingLabel(t.asking.tool)}</span>
        ) : (
          !action && <span className="flex-none text-xs font-normal text-ink-soft">{stage.label}</span>
        )}
      </button>
      {action && (
        <button
          type="button"
          onClick={onAction}
          className="h-8 flex-none rounded-lg bg-ink px-3 text-[12.5px] font-medium text-white hover:bg-ink/85"
        >
          {action}
        </button>
      )}
    </li>
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
        className="flex h-12 w-full flex-none items-center gap-2 px-4 font-medium text-ink-soft hover:bg-bg hover:text-ink"
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
      className={`flex flex-none flex-col gap-2 p-3 ${dragging ? 'bg-line-soft outline-2 -outline-offset-4 outline-ink outline-dashed' : ''}`}
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
