import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { OutputPanel } from '#/components/OutputPanel'
import { ProjectRail } from '#/components/ProjectRail'
import { ServiceCard, STATUS } from '#/components/ServiceCard'
import { TaskSidebar } from '#/components/TaskSidebar'
import { PlayIcon } from '#/components/icons'
import {
  addTask,
  getProjectState,
  getProjects,
  sendErrorToTask,
  setTaskStatus,
  startAll,
  startService,
  stopAll,
  stopService,
} from '#/server/fns'
import type { TaskStatus } from '#/server/types'

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
  const [state, setState] = useState(initial.state)
  const [projects, setProjects] = useState(initial.projects)
  const [selected, setSelected] = useState(initial.state.logService)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [sentAt, setSentAt] = useState<Record<string, number>>({})
  const [now, setNow] = useState(() => Date.now())

  // Switching projects swaps in that project's loader data.
  useEffect(() => {
    setState(initial.state)
    setProjects(initial.projects)
    setSelected(initial.state.logService)
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

  async function run(id: string, action: () => Promise<unknown>) {
    setBusy((b) => ({ ...b, [id]: true }))
    try {
      await action()
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
    const action = STATUS[s.status].action
    void run(serviceId, () =>
      action === 'Stop' ? stopService(ref(serviceId)) : startService(ref(serviceId)),
    )
  }

  const current = state.services.find((s) => s.id === selected) ?? state.services[0]
  const running = state.services.filter((s) => s.status === 'running' || s.status === 'starting').length
  const sent = current ? sentAt[current.id] === current.lastSeq : false

  return (
    <div className="flex min-h-screen flex-wrap bg-bg text-sm text-ink">
      <ProjectRail projects={projects} current={projectId} />

      <div className="flex min-w-0 flex-[999_1_560px] flex-wrap">
        <main className="flex min-w-0 flex-[999_1_520px] flex-col gap-7 px-8 pt-7 pb-10 max-sm:px-4">
          {state.configSource === 'example' && (
            <p className="rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-ink-soft">
              You're looking at the sample project.{' '}
              <Link to="/new" className="font-medium text-ink underline underline-offset-2">
                Add your first project
              </Link>{' '}
              and it takes the sample's place.
            </p>
          )}

          <header className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase">Project</div>
              <h1 className="text-3xl font-semibold tracking-[-0.015em]">{state.name}</h1>
              <div className="font-mono text-xs text-ink-soft">{state.path}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1.5 text-[13px] text-ink-soft">
                {running} of {state.services.length} running
              </span>
              <Link
                to="/p/$projectId/settings"
                params={{ projectId }}
                aria-label="Project settings"
                title="Project settings"
                className="flex size-10 items-center justify-center rounded-[10px] border border-line bg-surface text-ink-soft hover:bg-line-soft hover:text-ink"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </Link>
              <button
                type="button"
                onClick={() => void run('__all', () => stopAll({ data: { projectId } }))}
                disabled={busy.__all || running === 0}
                className="h-10 rounded-[10px] border border-line bg-surface px-4 font-medium hover:bg-line-soft disabled:opacity-50"
              >
                Stop all
              </button>
              <button
                type="button"
                onClick={() => void run('__all', () => startAll({ data: { projectId } }))}
                disabled={busy.__all || running === state.services.length}
                className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-ink px-4 font-medium text-white hover:bg-ink/85 disabled:opacity-50"
              >
                <PlayIcon size={14} />
                Start all
              </button>
            </div>
          </header>

          <section aria-labelledby="svc-h" className="flex flex-col gap-3">
            <h2 id="svc-h" className="text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase">
              Services
            </h2>
            {state.services.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line p-6 text-center text-ink-soft">
                This project has no services yet. Add them under its entry in pitwall.config.json.
              </p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3">
                {state.services.map((s) => (
                  <ServiceCard
                    key={s.id}
                    service={s}
                    selected={s.id === current?.id}
                    now={now}
                    busy={!!busy[s.id]}
                    onSelect={() => setSelected(s.id)}
                    onToggle={() => toggle(s.id)}
                  />
                ))}
              </div>
            )}
          </section>

          {state.services.length > 0 && (
            <OutputPanel
              services={state.services}
              current={current}
              logs={current?.id === state.logService ? state.logs : []}
              sent={sent}
              onSelect={setSelected}
              onRestart={() => current && toggle(current.id)}
              onSend={() => {
                if (!current) return
                const seq = current.lastSeq
                void run(`send:${current.id}`, async () => {
                  await sendErrorToTask(ref(current.id))
                  setSentAt((m) => ({ ...m, [current.id]: seq }))
                })
              }}
            />
          )}
        </main>

        <TaskSidebar
          projectName={state.name}
          tasks={state.tasks}
          now={now}
          onAdd={async (title) => {
            await addTask({ data: { projectId, title } })
            await refresh()
          }}
          onSetStatus={(id, status: TaskStatus) =>
            void run(`task:${id}`, () => setTaskStatus({ data: { id, status } }))
          }
        />
      </div>
    </div>
  )
}
