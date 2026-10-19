import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Menu } from '#/components/Menu'
import { OutputPanel } from '#/components/OutputPanel'
import { ProjectStrip } from '#/components/ProjectStrip'
import { ServiceCard, STATUS } from '#/components/ServiceCard'
import { TaskSidebar } from '#/components/TaskSidebar'
import { TaskView, type TaskCommand } from '#/components/TaskView'
import { ToolsView } from '#/components/ToolsView'
import { FolderInput } from '#/components/ui'
import { errorMessage } from '#/lib/errors'
import { PlayIcon, PlusIcon, StopIcon } from '#/components/icons'
import { showToast } from '#/lib/toast'
import {
  addService,
  addTask,
  confirmTask,
  dismissTask,
  doTask,
  followUpTask,
  answerTask,
  remoteTask,
  getProjectState,
  getTaskDetail,
  getProjects,
  getSkills,
  getSuggestions,
  ignoreSuggestion,
  planTask,
  reopenTask,
  restartTask,
  removeProject,
  removeService,
  restoreProject,
  restoreService,
  startAll,
  startService,
  stopAll,
  stopService,
  stopTask,
  setTaskModel,
  syncProject,
  updateProjectInfo,
  updateService,
} from '#/server/fns'
import type { DetectedService, ProjectState, Task, TaskDetail } from '#/server/types'
import type { Skill } from '#/server/tools'

const POLL_MS = 1000

export const Route = createFileRoute('/p/$projectId')({
  // ?task=<id> opens that task in the main panel, so a task can be linked to.
  validateSearch: (search: Record<string, unknown>): { task?: string; tools?: 1 } =>
    typeof search.task === 'string' && search.task
      ? { task: search.task }
      : search.tools === 1 || search.tools === '1'
        ? { tools: 1 }
        : {},
  loader: async ({ params }) => {
    const [projects, state] = await Promise.all([
      getProjects(),
      getProjectState({ data: { projectId: params.projectId } }),
    ])
    if (!state) throw notFound()
    return { projects, state }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? pageTitle(loaderData.state.name, loaderData.projects) : 'Pitwall' }],
  }),
  component: Workspace,
})

/** "(3) younote · Pitwall": what waits on you across all projects, visible from any tab. */
function pageTitle(name: string, projects: { needsYou: number }[]) {
  const waiting = projects.reduce((n, p) => n + p.needsYou, 0)
  return `${waiting ? `(${waiting}) ` : ''}${name} · Pitwall`
}

function Workspace() {
  const { projectId } = Route.useParams()
  const { task: openTaskId, tools: toolsOpen } = Route.useSearch()
  const initial = Route.useLoaderData()
  const navigate = useNavigate()
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null)
  const [planVersion, setPlanVersion] = useState<number | null>(null)
  const [state, setState] = useState(initial.state)
  const [projects, setProjects] = useState(initial.projects)
  const [selected, setSelected] = useState(initial.state.logService)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [now, setNow] = useState(() => Date.now())
  const [suggestions, setSuggestions] = useState<DetectedService[]>([])
  const [editing, setEditing] = useState<'name' | 'folder' | null>(null)

  // Switching projects swaps in that project's loader data.
  useEffect(() => {
    setState(initial.state)
    setProjects(initial.projects)
    setSelected(initial.state.logService)
    setEditing(null)
  }, [initial])

  const refresh = useCallback(async () => {
    const [s, p, d] = await Promise.all([
      getProjectState({ data: { projectId, logService: selected ?? undefined } }),
      getProjects(),
      openTaskId ? getTaskDetail({ data: { id: openTaskId, v: planVersion ?? undefined } }) : null,
    ])
    if (s) setState(s)
    setProjects(p)
    setTaskDetail(d)
    setNow(Date.now())
  }, [projectId, selected, openTaskId, planVersion])

  // The project's and your skills, for the task boxes' "/" suggestions; once per project.
  const [skills, setSkills] = useState<Skill[]>([])
  useEffect(() => {
    getSkills({ data: { projectId } })
      .then(setSkills)
      .catch(() => setSkills([]))
  }, [projectId, toolsOpen])

  function openTools(open: boolean) {
    setTaskDetail(null)
    void navigate({ to: '/p/$projectId', params: { projectId }, search: open ? { tools: 1 } : {}, replace: true })
  }

  function openTask(id: string | null) {
    setPlanVersion(null)
    if (!id) setTaskDetail(null)
    void navigate({ to: '/p/$projectId', params: { projectId }, search: id ? { task: id } : {}, replace: true })
  }

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  // head() only runs on navigation; keep the count current as tasks move.
  const title = pageTitle(state.name, projects)
  useEffect(() => {
    document.title = title
  }, [title])

  const loadSuggestions = useCallback(() => {
    getSuggestions({ data: { projectId } })
      .then(setSuggestions)
      .catch(() => setSuggestions([]))
  }, [projectId])
  useEffect(loadSuggestions, [loadSuggestions])

  /** Run an action; failures show as a toast instead of breaking the page. */
  async function run(id: string, action: () => Promise<unknown>) {
    setBusy((b) => ({ ...b, [id]: true }))
    try {
      await action()
    } catch (e) {
      showToast(errorMessage(e))
    } finally {
      setBusy((b) => ({ ...b, [id]: false }))
      void refresh()
    }
  }

  const ref = (serviceId: string) => ({ data: { projectId, serviceId } })

  function toggle(serviceId: string) {
    const s = state.services.find((x) => x.id === serviceId)
    if (!s) return
    setSelected(serviceId)
    void run(serviceId, () =>
      STATUS[s.status].action === 'Stop' ? stopService(ref(serviceId)) : startService(ref(serviceId)),
    )
  }

  function removeOneService(serviceId: string) {
    const s = state.services.find((x) => x.id === serviceId)
    void run(serviceId, async () => {
      const removed = await removeService(ref(serviceId))
      if (!removed) return
      loadSuggestions()
      showToast(`Removed ${s?.name ?? 'service'}`, {
        label: 'Undo',
        run: async () => {
          await restoreService({ data: removed })
          loadSuggestions()
          void refresh()
        },
      }, 10_000)
    })
  }

  async function removeThisProject() {
    const name = state.name
    try {
      const removed = await removeProject({ data: { projectId } })
      await navigate({ to: '/' })
      if (removed) {
        showToast(`Removed ${name}`, {
          label: 'Undo',
          run: async () => {
            const { id } = await restoreProject({ data: removed })
            await navigate({ to: '/p/$projectId', params: { projectId: id } })
          },
        }, 10_000)
      }
    } catch (e) {
      showToast(errorMessage(e))
    }
  }

  /** Everything you can do to a task; closing ones offer Undo. */
  async function taskCommand(task: Task, c: TaskCommand) {
    const id = task.id
    try {
      if (c.type === 'plan') await planTask({ data: { id, note: c.note } })
      else if (c.type === 'do') await doTask({ data: { id, note: c.note } })
      else if (c.type === 'confirm') await confirmTask({ data: { id, ok: c.ok, note: c.note } })
      else if (c.type === 'stop') await stopTask({ data: { id } })
      else if (c.type === 'restart') await restartTask({ data: { id } })
      else if (c.type === 'reopen') await reopenTask({ data: { id } })
      else if (c.type === 'remote') await remoteTask({ data: { id, on: c.on } })
      else if (c.type === 'answer') await answerTask({ data: { id, decision: c.decision } })
      else if (c.type === 'model') await setTaskModel({ data: { id, model: c.model } })
      else if (c.type === 'follow') {
        // Open the new task, so you see it start.
        const next = await followUpTask({
          data: { id, title: c.note, attachments: c.attachments, how: c.how, model: c.model },
        })
        openTask(next)
      }
      else {
        const stage = await dismissTask({ data: { id, done: c.type === 'done' } })
        showToast(c.type === 'done' ? 'Marked done' : 'Dismissed', {
          label: 'Undo',
          run: async () => {
            await reopenTask({ data: { id, stage } })
            void refresh()
          },
        })
      }
      if (c.type === 'confirm' && c.ok) {
        showToast('Done', {
          label: 'Undo',
          run: async () => {
            await reopenTask({ data: { id, stage: 'check' } })
            void refresh()
          },
        })
      }
      if (c.type === 'plan' || (c.type === 'confirm' && !c.ok)) setPlanVersion(null)
    } catch (e) {
      showToast(errorMessage(e))
    }
    await refresh()
  }

  const current = state.services.find((s) => s.id === selected) ?? state.services[0]
  const isUpStatus = (st: string) => st === 'running' || st === 'starting'
  const anyUp = state.services.some((s) => isUpStatus(s.status))
  // Start all is the default; Stop all takes its place only once everything runs.
  const allUp = state.services.length > 0 && state.services.every((s) => isUpStatus(s.status))

  return (
    <div className="flex min-h-screen bg-bg text-sm text-ink">
      <div className="flex min-w-0 flex-1 flex-wrap">
        <main className="flex min-w-0 flex-[999_1_520px] flex-col gap-6 px-8 pt-5 pb-10 max-sm:px-4">
          <ProjectStrip projects={projects} current={projectId} cloud={state.cloud} />
          {/* The strip's active chip names the project; this line says where it lives and what you can do. */}
          <h1 className="sr-only">{state.name}</h1>
          <header className="flex items-center gap-x-3 gap-y-2 max-sm:flex-wrap">
            {/* The buttons follow this line, which only stretches while an inline edit needs the room.
                On a phone the buttons drop to their own row rather than squeeze it. */}
            <div
              className={`flex min-w-0 items-center gap-x-2 overflow-hidden text-xs text-ink-soft max-sm:min-w-[260px] ${editing ? 'flex-1' : ''}`}
            >
              {editing === 'name' ? (
                <InlineName
                  value={state.name}
                  onCancel={() => setEditing(null)}
                  onSave={async (name) => {
                    setEditing(null)
                    await run('__info', () => updateProjectInfo({ data: { projectId, name } }))
                  }}
                />
              ) : editing === 'folder' ? (
                <InlineFolder
                  value={state.path}
                  onCancel={() => setEditing(null)}
                  onSave={async (path) => {
                    await updateProjectInfo({ data: { projectId, path } })
                    setEditing(null)
                    loadSuggestions()
                    void refresh()
                  }}
                />
              ) : (
                <>
                  {/* The path gives way first; what there is to sync matters more. */}
                  <span className="min-w-[8ch] shrink-[100] truncate font-mono" title={state.path}>
                    {state.path}
                  </span>
                  {state.git && (
                    <>
                      <span aria-hidden="true" className="flex-none">
                        ·
                      </span>
                      <GitFacts git={state.git} />
                    </>
                  )}
                </>
              )}
            </div>
            <div className="flex flex-none items-center gap-1.5">
              <Menu
                label="Project options"
                size="sm"
                items={[
                  ...(anyUp && !allUp
                    ? [{ label: 'Stop all', onSelect: () => void run('__all', () => stopAll({ data: { projectId } })) }]
                    : []),
                  { label: 'Claude’s tools', onSelect: () => openTools(true) },
                  { label: 'Rename', onSelect: () => setEditing('name') },
                  { label: 'Change folder', onSelect: () => setEditing('folder') },
                  { label: 'Remove project', onSelect: () => void removeThisProject(), danger: true },
                ]}
              />
              {state.git && (
                <SyncButton
                  git={state.git}
                  busy={!!busy.__sync}
                  onSync={() =>
                    void run('__sync', async () => {
                      const r = await syncProject({ data: { projectId } })
                      showToast(syncResult(r))
                    })
                  }
                />
              )}
              {state.services.length > 0 &&
                (allUp ? (
                  <button
                    type="button"
                    onClick={() => void run('__all', () => stopAll({ data: { projectId } }))}
                    disabled={busy.__all}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium whitespace-nowrap hover:bg-line-soft disabled:opacity-50"
                  >
                    <StopIcon size={11} />
                    Stop all
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void run('__all', () => startAll({ data: { projectId } }))}
                    disabled={busy.__all}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-[13px] font-medium whitespace-nowrap text-white hover:bg-ink/85 disabled:opacity-50"
                  >
                    <PlayIcon size={12} />
                    Start all
                  </button>
                ))}
            </div>
          </header>

          <section aria-label="Services" className="flex flex-col gap-3">
            {state.services.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line p-6 text-center text-ink-soft">
                {suggestions.length ? (
                  'Nothing runs here yet. Add it from below.'
                ) : (
                  <>
                    Nothing runs here yet. Add a task like <span className="font-medium text-ink">Create a Vite + React app</span>{' '}
                    and Claude builds it; Pitwall offers to run it once it appears.
                  </>
                )}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {state.services.map((s) => (
                  <ServiceCard
                    key={s.id}
                    service={s}
                    selected={s.id === current?.id}
                    onSelect={() => {
                      setSelected(s.id)
                      if (openTaskId) openTask(null)
                    }}
                    onToggle={() => toggle(s.id)}
                    onSave={(change) => run(s.id, () => updateService({ data: { projectId, serviceId: s.id, ...change } }))}
                    onRemove={() => removeOneService(s.id)}
                  />
                ))}
              </div>
            )}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink-soft">
                <span className="mr-1">Also in this folder:</span>
                {suggestions.map((sug) => (
                  <button
                    key={`${sug.cwd}|${sug.command}`}
                    type="button"
                    title={`$ ${sug.command}`}
                    disabled={!!busy[`add:${sug.id}`]}
                    onClick={() =>
                      void run(`add:${sug.id}`, async () => {
                        await addService({ data: { projectId, service: sug } })
                        setSuggestions((list) => list.filter((x) => x !== sug))
                      })
                    }
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 font-medium text-ink hover:border-ink disabled:opacity-50"
                  >
                    <PlusIcon size={13} />
                    {sug.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    void run('dismiss', async () => {
                      const list = suggestions
                      setSuggestions([])
                      for (const sug of list) await ignoreSuggestion({ data: { projectId, service: sug } })
                    })
                  }
                  className="h-8 rounded-full px-2.5 hover:bg-line-soft hover:text-ink"
                >
                  Dismiss
                </button>
              </div>
            )}
          </section>

          {toolsOpen ? (
            <ToolsView
              projectId={projectId}
              onClose={() => openTools(false)}
              onWriteSkill={async (what) => {
                const task = await addTask({
                  data: {
                    projectId,
                    how: 'do',
                    title: `Write a skill for this project: ${what.trim()}\n\nCreate it as .claude/skills/<short-kebab-name>/SKILL.md, in the SKILL.md format: front matter with name and description (say when to use it), then clear instructions.`,
                  },
                })
                openTask(task.id)
              }}
            />
          ) : openTaskId && taskDetail?.task.id === openTaskId ? (
            <TaskView
              detail={taskDetail}
              now={now}
              version={planVersion}
              onVersion={setPlanVersion}
              onCommand={(c) => taskCommand(taskDetail.task, c)}
              onClose={() => openTask(null)}
              onOpenTask={(id) => openTask(id)}
              skills={skills}
            />
          ) : (
            current && <OutputPanel service={current} logs={current.id === state.logService ? state.logs : []} />
          )}
        </main>

        <TaskSidebar
          projectName={state.name}
          skills={skills}
          tasks={state.tasks}
          now={now}
          onAdd={async (title, attachments, how, model) => {
            try {
              await addTask({ data: { projectId, title, attachments, how, model } })
              return true
            } catch (e) {
              showToast(errorMessage(e))
              return false
            } finally {
              void refresh()
            }
          }}
          selected={openTaskId ?? null}
          onOpen={(task) => openTask(task.id)}
          onAction={(task) => {
            openTask(task.id)
            // Plan straight away (or just do a simple one); steering is in the task view.
            if (task.stage === 'ready') void taskCommand(task, task.simple ? { type: 'do' } : { type: 'plan' })
          }}
          onReopen={(task) => void taskCommand(task, { type: 'reopen' })}
        />
      </div>
    </div>
  )
}

type Git = NonNullable<ProjectState['git']>
type SyncResult = { pushed: number; pulled: number; newBranch: boolean } | { conflict: string[] }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function syncResult(r: SyncResult) {
  if ('conflict' in r) return `GitHub changed the same lines in ${r.conflict.join(', ')}. Nothing was lost; there's a task to merge them.`
  const parts = [
    r.newBranch ? 'Pushed the branch to GitHub' : r.pushed ? `Pushed ${plural(r.pushed, 'commit')}` : '',
    r.pulled ? `pulled ${plural(r.pulled, 'commit')}` : '',
  ].filter(Boolean)
  return parts.length ? `${parts.join(' and ')}.`.replace(/^p/, 'P') : 'Already up to date.'
}

/** Where the branch stands, as plain text: "⎇ main · 2 changed files · 3 new on GitHub". */
function GitFacts({ git }: { git: Git }) {
  const facts = [
    git.changed ? plural(git.changed, 'changed file') : '',
    git.ahead ? `${git.ahead} to push` : '',
    !git.upstream && git.branch ? 'not on GitHub yet' : '',
    git.behind ? `${git.behind} new on GitHub` : '',
  ].filter(Boolean)
  return (
    // Shrinks only once the path beside it can't (a plain 1 would still lose a pixel to it).
    <span className="inline-flex min-w-0 shrink-[0.001] items-center gap-x-2 whitespace-nowrap">
      <span className="inline-flex items-center gap-1 font-mono">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <circle cx="18" cy="8" r="2.5" />
          <path d="M6 8.5v7M18 10.5c0 4-6 3-11 5.5" />
        </svg>
        {git.branch ?? 'no branch'}
      </span>
      <span aria-hidden="true">·</span>
      <span className="truncate">{facts.length ? facts.join(' · ') : 'Up to date'}</span>
    </span>
  )
}

/** The one git button, named for what it will do: Push, Pull or Sync. Hidden when there's nothing to do. */
function SyncButton({ git, busy, onSync }: { git: Git; busy: boolean; onSync: () => void }) {
  const local = git.changed > 0 || git.ahead > 0 || !git.upstream
  const label = local && git.behind ? 'Sync' : local ? 'Push' : git.behind ? 'Pull' : null
  if (!label || !git.branch) return null
  return (
    <button
      type="button"
      onClick={onSync}
      disabled={busy}
      className="inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-[13px] font-medium whitespace-nowrap hover:bg-line-soft disabled:opacity-50"
    >
      {busy ? `${label === 'Pull' ? 'Pulling' : label === 'Push' ? 'Pushing' : 'Syncing'}…` : label}
    </button>
  )
}

function InlineName({
  value,
  onSave,
  onCancel,
}: {
  value: string
  onSave: (name: string) => Promise<void>
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(value)
  const done = useRef(false)
  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    const name = draft.trim()
    if (save && name && name !== value) void onSave(name)
    else onCancel()
  }
  return (
    <input
      aria-label="Project name"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true)
        else if (e.key === 'Escape') finish(false)
      }}
      onBlur={() => finish(true)}
      className="h-8 w-full max-w-[360px] rounded-lg border border-ink bg-surface px-2 text-sm font-semibold text-ink outline-none"
    />
  )
}

function InlineFolder({
  value,
  onSave,
  onCancel,
}: {
  value: string
  onSave: (path: string) => Promise<void>
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setSaving(true)
        setError(null)
        try {
          await onSave(draft)
        } catch (err) {
          setError(errorMessage(err))
          setSaving(false)
        }
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      className="flex w-full max-w-[640px] flex-col gap-1.5 text-sm text-ink"
    >
      <label htmlFor="project-folder" className="sr-only">
        Project folder
      </label>
      <div className="flex gap-2">
        <FolderInput id="project-folder" value={draft} onChange={setDraft} autoFocus />
        <button type="button" onClick={onCancel} className="h-11 flex-none rounded-[10px] px-3 font-medium hover:bg-line-soft">
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !draft.trim()}
          className="h-11 flex-none rounded-[10px] bg-ink px-4 font-medium text-white hover:bg-ink/85 disabled:opacity-50"
        >
          Save
        </button>
      </div>
      {error && <p role="alert" className="text-[13px] text-err">{error}</p>}
    </form>
  )
}
