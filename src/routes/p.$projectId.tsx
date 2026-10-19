import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Menu } from '#/components/Menu'
import { OutputPanel } from '#/components/OutputPanel'
import { ProjectRail } from '#/components/ProjectRail'
import { ServiceCard, STATUS } from '#/components/ServiceCard'
import { TaskSidebar } from '#/components/TaskSidebar'
import { TaskView, type TaskCommand } from '#/components/TaskView'
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
  syncProject,
  updateProjectInfo,
  updateService,
} from '#/server/fns'
import type { DetectedService, ProjectState, Task, TaskDetail } from '#/server/types'

const POLL_MS = 1000

export const Route = createFileRoute('/p/$projectId')({
  // ?task=<id> opens that task in the main panel, so a task can be linked to.
  validateSearch: (search: Record<string, unknown>): { task?: string } =>
    typeof search.task === 'string' && search.task ? { task: search.task } : {},
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
  const { task: openTaskId } = Route.useSearch()
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
      else if (c.type === 'follow') {
        // Open the new task, so you see it start.
        const next = await followUpTask({ data: { id, title: c.note, how: c.how } })
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
    <div className="flex min-h-screen flex-wrap bg-bg text-sm text-ink">
      <ProjectRail projects={projects} current={projectId} cloud={state.cloud} />

      <div className="flex min-w-0 flex-[999_1_560px] flex-wrap">
        <main className="flex min-w-0 flex-[999_1_520px] flex-col gap-7 px-8 pt-7 pb-10 max-sm:px-4">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase">Project</div>
              {editing === 'name' ? (
                <InlineName
                  value={state.name}
                  onCancel={() => setEditing(null)}
                  onSave={async (name) => {
                    setEditing(null)
                    await run('__info', () => updateProjectInfo({ data: { projectId, name } }))
                  }}
                />
              ) : (
                <h1 className="truncate text-3xl font-semibold tracking-[-0.015em]">{state.name}</h1>
              )}
              {editing === 'folder' ? (
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
                <div className="truncate font-mono text-xs text-ink-soft">{state.path}</div>
              )}
              {state.git && (
                <GitLine
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
            </div>
            <div className="flex items-center gap-1.5">
              <Menu
                label="Project options"
                items={[
                  ...(anyUp && !allUp
                    ? [{ label: 'Stop all', onSelect: () => void run('__all', () => stopAll({ data: { projectId } })) }]
                    : []),
                  { label: 'Rename', onSelect: () => setEditing('name') },
                  { label: 'Change folder', onSelect: () => setEditing('folder') },
                  { label: 'Remove project', onSelect: () => void removeThisProject(), danger: true },
                ]}
              />
              {state.services.length > 0 &&
                (allUp ? (
                  <button
                    type="button"
                    onClick={() => void run('__all', () => stopAll({ data: { projectId } }))}
                    disabled={busy.__all}
                    className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 font-medium hover:bg-line-soft disabled:opacity-50"
                  >
                    <StopIcon size={13} />
                    Stop all
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void run('__all', () => startAll({ data: { projectId } }))}
                    disabled={busy.__all}
                    className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-ink px-4 font-medium text-white hover:bg-ink/85 disabled:opacity-50"
                  >
                    <PlayIcon size={14} />
                    Start all
                  </button>
                ))}
            </div>
          </header>

          <section aria-labelledby="svc-h" className="flex flex-col gap-3">
            <h2 id="svc-h" className="text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase">
              Services
            </h2>
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
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {state.services.map((s) => (
                  <ServiceCard
                    key={s.id}
                    service={s}
                    selected={s.id === current?.id}
                    now={now}
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

          {openTaskId && taskDetail?.task.id === openTaskId ? (
            <TaskView
              detail={taskDetail}
              now={now}
              version={planVersion}
              onVersion={setPlanVersion}
              onCommand={(c) => taskCommand(taskDetail.task, c)}
              onClose={() => openTask(null)}
              onOpenTask={(id) => openTask(id)}
            />
          ) : (
            current && <OutputPanel service={current} logs={current.id === state.logService ? state.logs : []} />
          )}
        </main>

        <TaskSidebar
          projectName={state.name}
          tasks={state.tasks}
          now={now}
          onAdd={async (title, attachments, how) => {
            try {
              await addTask({ data: { projectId, title, attachments, how } })
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

/** The branch, what there is to sync, and the one button that does it (Push, Pull or Sync). */
function GitLine({ git, busy, onSync }: { git: Git; busy: boolean; onSync: () => void }) {
  const local = git.changed > 0 || git.ahead > 0 || !git.upstream
  const label = local && git.behind ? 'Sync' : local ? 'Push' : git.behind ? 'Pull' : null
  const facts = [
    git.changed ? plural(git.changed, 'changed file') : '',
    git.ahead ? `${git.ahead} to push` : '',
    !git.upstream && git.branch ? 'not on GitHub yet' : '',
    git.behind ? `${git.behind} new on GitHub` : '',
  ].filter(Boolean)
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
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
      <span>{facts.length ? facts.join(' · ') : 'Up to date'}</span>
      {label && git.branch && (
        <button
          type="button"
          onClick={onSync}
          disabled={busy}
          className="ml-1 h-7 rounded-lg border border-line bg-surface px-2.5 font-medium text-ink hover:bg-line-soft disabled:opacity-50"
        >
          {busy ? `${label === 'Pull' ? 'Pulling' : label === 'Push' ? 'Pushing' : 'Syncing'}…` : label}
        </button>
      )}
    </div>
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
      className="-mx-2 h-11 max-w-[520px] rounded-lg border border-ink bg-surface px-2 text-3xl font-semibold tracking-[-0.015em] outline-none"
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
      className="mt-1 flex max-w-[640px] flex-col gap-1.5"
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
