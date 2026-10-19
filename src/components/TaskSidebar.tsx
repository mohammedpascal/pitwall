import { useEffect, useRef, useState } from 'react'
import type { AttachmentUpload, Task, TaskStart } from '#/server/types'
import { ago } from '#/lib/format'
import { KIND, STAGE, askingLabel, byAttention, isClosed, waitsOnYou } from '#/lib/stages'
import { PaperclipIcon, PlusIcon, sourceIcon } from './icons'
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
      className="flex max-w-full flex-[1_1_340px] flex-col gap-4 border-l border-line bg-surface px-[22px] py-7"
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
  // A simple task needs no plan, so its button does it. A question from Claude comes first.
  const action = t.asking ? 'Answer' : t.stage === 'ready' && t.simple ? 'Do it' : stage.action
  return (
    <article
      onClick={onOpen}
      className={`flex cursor-pointer flex-col gap-2.5 rounded-[14px] border bg-surface p-3.5 ${
        selected ? 'border-ink' : 'border-line hover:border-ink-faint'
      }`}
    >
      <div className="flex items-center justify-between gap-2 text-xs text-ink-soft">
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
          {t.kind && (
            <span className="rounded-full border border-line px-1.5 py-px text-[11px] font-semibold text-ink">{KIND[t.kind]}</span>
          )}
          <Icon />
          {t.sourceLabel}
          {t.attachments?.length ? (
            <span className="inline-flex items-center gap-0.5" title={`${t.attachments.length} attached`}>
              <PaperclipIcon size={12} />
              {t.attachments.length}
            </span>
          ) : null}
        </span>
        <span className="flex-none">{ago(t.lastSeenAt ?? t.createdAt, now)}</span>
      </div>
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
        {t.asking ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-ink">
            <span aria-hidden="true" className="size-1.5 flex-none rounded-full bg-warn" />
            {askingLabel(t.asking.tool)}
          </span>
        ) : (
          <span className={`inline-flex items-center gap-1.5 text-xs ${stage.working ? 'text-ink-soft' : 'font-medium text-ink'}`}>
            {stage.working && <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-ink-soft" />}
            {stage.label}
          </span>
        )}
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

/** A file picked, pasted or dropped, before the task is added. */
interface Picked {
  id: number
  file: File
  /** Thumbnail for images. */
  preview: string | null
}

const MAX_FILE = 20 * 1024 * 1024
let nextId = 0

function toUpload(file: File): Promise<AttachmentUpload> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve({ name: file.name, type: file.type, data: String(r.result).split(',')[1] ?? '' })
    r.onerror = () => reject(new Error(`Couldn’t read ${file.name}`))
    r.readAsDataURL(file)
  })
}

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

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
  const [files, setFiles] = useState<Picked[]>([])
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  // Thumbnails are object URLs; let them go when the files do.
  const urls = useRef(new Set<string>())
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])

  function addFiles(list: FileList | File[]) {
    const incoming = [...list]
    const tooBig = incoming.filter((f) => f.size > MAX_FILE)
    setProblem(tooBig.length ? `${tooBig.map((f) => f.name).join(', ')} ${tooBig.length > 1 ? 'are' : 'is'} over 20 MB` : null)
    const picked = incoming
      .filter((f) => f.size <= MAX_FILE)
      .map((file) => {
        const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
        if (preview) urls.current.add(preview)
        // Pasted screenshots are all called image.png; give them a better name.
        const named =
          file.name === 'image.png' || !file.name
            ? new File([file], `screenshot-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.png`, { type: file.type })
            : file
        return { id: ++nextId, file: named, preview }
      })
    setFiles((f) => [...f, ...picked].slice(0, 10))
    setOpen(true)
  }

  function removeFile(p: Picked) {
    if (p.preview) {
      URL.revokeObjectURL(p.preview)
      urls.current.delete(p.preview)
    }
    setFiles((f) => f.filter((x) => x.id !== p.id))
  }

  function reset() {
    files.forEach((p) => p.preview && URL.revokeObjectURL(p.preview))
    setFiles([])
    setDraft('')
    setProblem(null)
    setOpen(false)
  }

  async function submit() {
    const title = draft.trim()
    if ((!title && !files.length) || saving) return
    setSaving(true)
    try {
      const uploads = await Promise.all(files.map((p) => toUpload(p.file)))
      if (await onAdd(title, uploads, mode, model)) reset()
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

      {files.length > 0 && (
        <ul aria-label="Attachments" className="flex flex-wrap gap-2">
          {files.map((p) => (
            <li key={p.id} className="flex max-w-full items-center gap-2 rounded-lg border border-line bg-bg py-1 pr-1 pl-1">
              {p.preview ? (
                <img src={p.preview} alt="" className="size-8 flex-none rounded object-cover" />
              ) : (
                <span className="flex size-8 flex-none items-center justify-center rounded bg-line-soft text-ink-soft">
                  <PaperclipIcon size={14} />
                </span>
              )}
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="max-w-[150px] truncate text-xs font-medium">{p.file.name}</span>
                <span className="text-[11px] text-ink-soft">{kb(p.file.size)}</span>
              </span>
              <button
                type="button"
                onClick={() => removeFile(p)}
                aria-label={`Remove ${p.file.name}`}
                className="flex size-7 flex-none items-center justify-center rounded-md text-ink-soft hover:bg-line-soft hover:text-ink"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {problem && (
        <p role="alert" className="text-xs text-err">
          {problem}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => picker.current?.click()}
          aria-label="Attach files"
          title="Attach files, or paste or drop them here"
          className="flex size-9 items-center justify-center rounded-lg text-ink-soft hover:bg-line-soft hover:text-ink"
        >
          <PaperclipIcon />
        </button>
        {/* How it runs on the left, the decision on the right; they wrap apart when narrow. */}
        <span className="mr-auto flex items-center gap-1.5">
          <ModelPicker model={model} onPick={setModel} />
          <ModePicker mode={mode} onPick={setMode} />
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={reset} className="h-9 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap hover:bg-line-soft">
            Cancel
          </button>
          <button
            type="submit"
            disabled={(!draft.trim() && !files.length) || saving}
            className="h-9 rounded-lg bg-ink px-3.5 text-[13px] font-medium whitespace-nowrap text-white hover:bg-ink/85 disabled:opacity-40"
          >
            {saving ? 'Adding…' : MODE[mode].button}
          </button>
        </span>
      </div>
    </form>
  )
}
