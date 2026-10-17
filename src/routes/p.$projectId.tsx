import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Menu } from '#/components/Menu'
import { OutputPanel } from '#/components/OutputPanel'
import { ProjectRail } from '#/components/ProjectRail'
import { ServiceCard, STATUS } from '#/components/ServiceCard'
import { TaskSidebar } from '#/components/TaskSidebar'
import { FolderInput } from '#/components/ui'
import { errorMessage } from '#/lib/errors'
import { PlayIcon, PlusIcon, StopIcon } from '#/components/icons'
import { showToast } from '#/lib/toast'
import {
  addService,
  addTask,
  getProjectState,
  getProjects,
  getSuggestions,
  ignoreSuggestion,
  removeProject,
  removeService,
  restoreProject,
  restoreService,
  setTaskStatus,
  startAll,
  startService,
  stopAll,
  stopService,
  updateProjectInfo,
  updateService,
} from '#/server/fns'
import type { DetectedService, Task } from '#/server/types'

const POLL_MS = 1000

export const Route = createFileRoute('/p/$projectId')({
  loader: async ({ params }) => {
    const [projects, state] = await Promise.all([
      getProjects(),
      getProjectState({ data: { projectId: params.projectId } }),
    ])
    if (!state) throw notFound()
    return { projects, state }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.state.name} · Pitwall` : 'Pitwall' }],
  }),
  component: Workspace,
})

function Workspace() {
  const { projectId } = Route.useParams()
  const initial = Route.useLoaderData()
  const navigate = useNavigate()
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
    const [s, p] = await Promise.all([
      getProjectState({ data: { projectId, logService: selected ?? undefined } }),
      getProjects(),
    ])
    if (s) setState(s)
    setProjects(p)
    setNow(Date.now())
  }, [projectId, selected])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

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

  function markDone(task: Task) {
    void run(`task:${task.id}`, async () => {
      await setTaskStatus({ data: { id: task.id, status: 'done' } })
      showToast('Marked done', {
        label: 'Undo',
        run: async () => {
          await setTaskStatus({ data: { id: task.id, status: 'open' } })
          void refresh()
        },
      })
    })
  }

  const current = state.services.find((s) => s.id === selected) ?? state.services[0]
  const isUpStatus = (st: string) => st === 'running' || st === 'starting'
  const anyUp = state.services.some((s) => isUpStatus(s.status))
  // Start all is the default; Stop all takes its place only once everything runs.
  const allUp = state.services.length > 0 && state.services.every((s) => isUpStatus(s.status))

  return (
    <div className="flex min-h-screen flex-wrap bg-bg text-sm text-ink">
      <ProjectRail projects={projects} current={projectId} />

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
                No services in this project{suggestions.length ? '. Add one from below.' : '.'}
              </p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {state.services.map((s) => (
                  <ServiceCard
                    key={s.id}
                    service={s}
                    selected={s.id === current?.id}
                    now={now}
                    onSelect={() => setSelected(s.id)}
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

          {current && (
            <OutputPanel service={current} logs={current.id === state.logService ? state.logs : []} />
          )}
        </main>

        <TaskSidebar
          projectName={state.name}
          tasks={state.tasks}
          now={now}
          onAdd={async (title) => {
            try {
              await addTask({ data: { projectId, title } })
            } catch (e) {
              showToast(errorMessage(e))
            }
            await refresh()
          }}
          onDone={markDone}
          onReopen={(task) => void run(`task:${task.id}`, () => setTaskStatus({ data: { id: task.id, status: 'open' } }))}
        />
      </div>
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
