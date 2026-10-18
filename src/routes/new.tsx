import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ErrorNote, FolderInput, PageHeader } from '#/components/ui'
import { errorMessage } from '#/lib/errors'
import { createProject, getProjects, getProjectsHome, openProject } from '#/server/fns'
import type { OpenResult } from '#/server/types'

export const Route = createFileRoute('/new')({
  loader: async () => ({ projects: await getProjects(), home: await getProjectsHome() }),
  head: () => ({ meta: [{ title: 'Open a project · Pitwall' }] }),
  component: OpenProject,
})

type Empty = Extract<OpenResult, { status: 'empty' }>

function OpenProject() {
  const { projects, home } = Route.useLoaderData()
  const navigate = useNavigate()
  const [folder, setFolder] = useState<string>(home)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [empty, setEmpty] = useState<Empty | null>(null)
  const [service, setService] = useState({ name: 'App', command: '' })

  const go = (id: string) => navigate({ to: '/p/$projectId', params: { projectId: id } })

  async function open() {
    if (!folder.trim() || busy) return
    setBusy(true)
    setError(null)
    setEmpty(null)
    try {
      const result = await openProject({ data: { path: folder } })
      if (result.status === 'opened') return void (await go(result.id))
      setEmpty(result)
      setBusy(false)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  async function create() {
    if (!empty || busy) return
    setBusy(true)
    setError(null)
    try {
      const { id } = await createProject({ data: { path: empty.path, name: empty.name, service } })
      await go(id)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg text-sm text-ink">
      <PageHeader back={projects.length > 0} />

      <main className="mx-auto flex w-full max-w-[620px] flex-col gap-6 px-6 pt-24 pb-16 max-sm:pt-12">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-[-0.015em]">
            {projects.length ? 'Open a project' : 'Open your first project'}
          </h1>
          <p className="text-[15px] leading-relaxed text-ink-soft">
            Pick its folder. Pitwall finds the apps inside and starts them.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void open()
          }}
          className="flex gap-2"
        >
          <label htmlFor="folder" className="sr-only">
            Project folder
          </label>
          <div className="min-w-0 flex-1">
            <FolderInput
              id="folder"
              value={folder}
              autoFocus
              onChange={(v) => {
                setFolder(v)
                setEmpty(null)
              }}
            />
          </div>
          <button
            type="submit"
            disabled={!folder.trim() || busy}
            className="h-11 flex-none rounded-[10px] bg-ink px-5 font-semibold text-white hover:bg-ink/85 disabled:opacity-50"
          >
            {busy && !empty ? 'Opening…' : 'Open'}
          </button>
        </form>

        {error && <ErrorNote text={error} />}

        {empty && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void create()
            }}
            className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5"
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-[15px] font-semibold">Nothing to run found in {empty.displayPath}</h2>
              <p className="text-[13px] text-ink-soft">What command starts it?</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="flex w-36 flex-col gap-1.5">
                <label htmlFor="svc-name" className="text-xs font-semibold text-ink-soft">
                  Name
                </label>
                <input
                  id="svc-name"
                  value={service.name}
                  onChange={(e) => setService((s) => ({ ...s, name: e.target.value }))}
                  className="h-11 rounded-[10px] border border-line bg-surface px-3 outline-none focus:border-ink"
                />
              </div>
              <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
                <label htmlFor="svc-cmd" className="text-xs font-semibold text-ink-soft">
                  Command
                </label>
                <input
                  id="svc-cmd"
                  autoFocus
                  value={service.command}
                  onChange={(e) => setService((s) => ({ ...s, command: e.target.value }))}
                  placeholder="npm run dev"
                  spellCheck={false}
                  className="h-11 rounded-[10px] border border-line bg-surface px-3 font-mono text-[13px] outline-none focus:border-ink"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={busy || !service.name.trim() || !service.command.trim()}
              className="h-11 self-start rounded-[10px] bg-ink px-5 font-semibold text-white hover:bg-ink/85 disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Add and start'}
            </button>
          </form>
        )}
      </main>
    </div>
  )
}
