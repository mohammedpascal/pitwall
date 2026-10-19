import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { RepoList } from '#/components/RepoList'
import { ErrorNote, FolderInput, PageHeader } from '#/components/ui'
import { errorMessage } from '#/lib/errors'
import {
  createEmptyProject,
  createProject,
  getGithubRepos,
  getProjects,
  getProjectsHome,
  getSetup,
  openProject,
} from '#/server/fns'
import type { OpenResult } from '#/server/types'

type From = 'github' | 'new' | 'folder'
const TABS: { id: From; label: string }[] = [
  { id: 'github', label: 'GitHub' },
  { id: 'new', label: 'New' },
  { id: 'folder', label: 'Folder' },
]

export const Route = createFileRoute('/new')({
  validateSearch: (s: Record<string, unknown>): { from?: From } =>
    s.from === 'github' || s.from === 'new' || s.from === 'folder' ? { from: s.from } : {},
  loader: async () => {
    const [projects, home, setup, github] = await Promise.all([
      getProjects(),
      getProjectsHome(),
      getSetup(),
      getGithubRepos(),
    ])
    return { projects, home, setup, github }
  },
  head: () => ({ meta: [{ title: 'Open a project · Pitwall' }] }),
  component: OpenProject,
})

type Empty = Extract<OpenResult, { status: 'empty' }>

const primary = 'h-11 flex-none rounded-[10px] bg-ink px-5 font-semibold text-white hover:bg-ink/85 disabled:opacity-50'

function OpenProject() {
  const { projects, setup, github } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate()
  // Your repos first when GitHub is signed in; otherwise a folder here.
  const from = search.from ?? (github.signedIn ? 'github' : 'folder')
  const go = (id: string) => navigate({ to: '/p/$projectId', params: { projectId: id } })

  return (
    <div className="min-h-screen bg-bg text-sm text-ink">
      <PageHeader back={projects.length > 0} />

      <main className="mx-auto flex w-full max-w-[620px] flex-col gap-6 px-6 pt-24 pb-16 max-sm:pt-12">
        {setup && !setup.done && (
          <Link
            to="/setup"
            className="self-start rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] font-medium hover:border-ink"
          >
            Finish setting up this machine →
          </Link>
        )}

        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-[-0.015em]">
            {projects.length ? 'Open a project' : 'Open your first project'}
          </h1>
          <p className="text-[15px] leading-relaxed text-ink-soft">
            From GitHub, a new one, or a folder on this machine. Pitwall finds the apps inside and starts them.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Where from"
          className="flex gap-1 self-start rounded-[12px] border border-line bg-surface p-1"
        >
          {TABS.map((t) => (
            <Link
              key={t.id}
              to="/new"
              search={{ from: t.id }}
              replace
              role="tab"
              aria-selected={from === t.id}
              className={`h-9 rounded-[9px] px-4 text-[13px] leading-9 font-semibold ${
                from === t.id ? 'bg-ink text-white' : 'text-ink-soft hover:bg-line-soft hover:text-ink'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>

        {from === 'github' && (
          <RepoList
            signedIn={github.signedIn}
            repos={github.repos}
            onOpen={(fullName) => openProject({ data: { path: fullName, allowEmpty: true } })}
            go={go}
          />
        )}
        {from === 'new' && <NewProject go={go} />}
        {from === 'folder' && <FolderProject go={go} />}
      </main>
    </div>
  )
}

/** A name, and that's it: an empty folder with git, for Claude to build in. */
function NewProject({ go }: { go: (id: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const { id } = await createEmptyProject({ data: { name } })
      await go(id)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
        className="flex gap-2"
      >
        <label htmlFor="new-name" className="sr-only">
          Project name
        </label>
        <input
          id="new-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My app"
          autoComplete="off"
          className="h-11 min-w-0 flex-1 rounded-[10px] border border-line bg-surface px-3 outline-none focus:border-ink"
        />
        <button type="submit" disabled={!name.trim() || busy} className={primary}>
          {busy ? 'Creating…' : 'Create'}
        </button>
      </form>
      <p className="-mt-3 text-[13px] text-ink-soft">An empty project. Add a task to have Claude build it.</p>
      {error && <ErrorNote text={error} />}
    </>
  )
}

/** A folder already on this machine (or a git URL, cloned into the projects folder). */
function FolderProject({ go }: { go: (id: string) => Promise<void> }) {
  const { home } = Route.useLoaderData()
  const [folder, setFolder] = useState<string>(home)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [empty, setEmpty] = useState<Empty | null>(null)
  const [service, setService] = useState({ name: 'App', command: '' })

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
      const { id } = await createProject({
        data: { path: empty.path, name: empty.name, service },
      })
      await go(id)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <>
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
          {busy && !empty ? (/^(https?:\/\/|git@)/.test(folder.trim()) ? 'Cloning…' : 'Opening…') : 'Open'}
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
    </>
  )
}
