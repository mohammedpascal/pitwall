import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '#/lib/errors'
import type { GithubRepo } from '#/server/fns'
import { createEmptyProject, createProject, getGithubRepos, getProjectsHome, openProject } from '#/server/fns'
import type { OpenResult } from '#/server/types'
import { RepoList } from './RepoList'
import { ErrorNote, FolderInput } from './ui'

type From = 'github' | 'new' | 'folder'
const TABS: { id: From; label: string }[] = [
  { id: 'github', label: 'GitHub' },
  { id: 'new', label: 'New' },
  { id: 'folder', label: 'Folder' },
]

type Empty = Extract<OpenResult, { status: 'empty' }>
export type OpenData = { home: string; github: { signedIn: boolean; repos: GithubRepo[] } }

const primary = 'h-11 flex-none rounded-[10px] bg-ink px-5 font-semibold text-white hover:bg-ink/85 disabled:opacity-50'

/** From GitHub, a new one, or a folder here: the same three ways on the first-run page and in the + dialog. */
export function OpenProject({ data, onOpened }: { data: OpenData; onOpened?: () => void }) {
  const navigate = useNavigate()
  // Your repos first when GitHub is signed in; otherwise a folder here.
  const [from, setFrom] = useState<From>(data.github.signedIn ? 'github' : 'folder')
  const go = async (id: string) => {
    await navigate({ to: '/p/$projectId', params: { projectId: id } })
    onOpened?.()
  }

  return (
    <>
      <div
        role="tablist"
        aria-label="Where from"
        className="flex gap-1 self-start rounded-[12px] border border-line bg-surface p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFrom(t.id)}
            role="tab"
            aria-selected={from === t.id}
            className={`h-9 rounded-[9px] px-4 text-[13px] font-semibold ${
              from === t.id ? 'bg-ink text-white' : 'text-ink-soft hover:bg-line-soft hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {from === 'github' && (
        <RepoList
          signedIn={data.github.signedIn}
          repos={data.github.repos}
          onOpen={(fullName) => openProject({ data: { path: fullName, allowEmpty: true } })}
          go={go}
        />
      )}
      {from === 'new' && <NewProject go={go} />}
      {from === 'folder' && <FolderProject home={data.home} go={go} />}
    </>
  )
}

/** The + in the project tabs: add one without leaving the project you're on. */
export function AddProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [data, setData] = useState<OpenData | null>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      // Fresh each time: repos you just pushed show up.
      setData(null)
      void Promise.all([getProjectsHome(), getGithubRepos()]).then(([home, github]) => setData({ home, github }))
    } else if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby="add-project-h"
      onClose={onClose}
      // A click on the backdrop lands on the dialog itself, outside its padding box's content.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="m-auto w-[min(620px,calc(100vw-32px))] rounded-2xl border border-line bg-bg p-0 text-sm text-ink backdrop:bg-ink/30"
    >
      <div className="flex max-h-[min(720px,calc(100vh-64px))] flex-col gap-5 overflow-y-auto p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 id="add-project-h" className="text-xl font-semibold tracking-[-0.01em]">
            Add project
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-9 items-center justify-center rounded-lg text-ink-soft hover:bg-line-soft hover:text-ink"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {open && (data ? <OpenProject data={data} onOpened={onClose} /> : <p className="text-ink-soft">Loading…</p>)}
      </div>
    </dialog>
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
function FolderProject({ home, go }: { home: string; go: (id: string) => Promise<void> }) {
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
        <button type="submit" disabled={!folder.trim() || busy} className={primary}>
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
