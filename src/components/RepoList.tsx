import { openSettings } from '#/lib/settings'
import { useState } from 'react'
import { errorMessage } from '#/lib/errors'
import type { GithubRepo } from '#/server/fns'
import type { OpenResult } from '#/server/types'
import { ErrorNote } from './ui'

const ago = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

/** Your GitHub repos: one click clones it into the projects folder (or opens the copy there). */
export function RepoList({
  signedIn,
  repos,
  onOpen,
  go,
}: {
  signedIn: boolean
  repos: GithubRepo[]
  onOpen: (fullName: string) => Promise<OpenResult>
  go: (id: string) => Promise<void>
}) {
  const [filter, setFilter] = useState('')
  const [cloning, setCloning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!signedIn) {
    return (
      <p className="rounded-2xl border border-dashed border-line p-6 text-center text-ink-soft">
        <button type="button" onClick={openSettings} className="font-medium text-ink underline">
          Sign in to GitHub
        </button>{' '}
        to see your repos here.
      </p>
    )
  }

  async function open(r: GithubRepo) {
    if (cloning) return
    if (r.openedId) return void (await go(r.openedId))
    setCloning(r.fullName)
    setError(null)
    try {
      const result = await onOpen(r.fullName)
      if (result.status === 'opened') return void (await go(result.id))
    } catch (e) {
      setError(errorMessage(e))
    }
    setCloning(null)
  }

  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = repos.filter((r) => words.every((w) => `${r.fullName} ${r.description ?? ''}`.toLowerCase().includes(w)))

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="repo-filter" className="sr-only">
        Find a repo
      </label>
      <input
        id="repo-filter"
        autoFocus
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Find a repo"
        autoComplete="off"
        spellCheck={false}
        className="h-11 rounded-[10px] border border-line bg-surface px-3 outline-none focus:border-ink"
      />
      {error && <ErrorNote text={error} />}
      <ul className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
        {shown.map((r) => (
          <li key={r.fullName} className="border-t border-line-soft first:border-t-0">
            <button
              type="button"
              onClick={() => void open(r)}
              disabled={!!cloning}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-bg disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2">
                  <span className="truncate font-semibold">{r.fullName}</span>
                  {r.private && (
                    <span className="flex-none rounded-md border border-line px-1.5 text-[11px] font-medium text-ink-soft">
                      Private
                    </span>
                  )}
                </span>
                {r.description && <span className="truncate text-[13px] text-ink-soft">{r.description}</span>}
              </span>
              <span className="flex-none text-xs text-ink-soft">
                {cloning === r.fullName ? 'Cloning…' : r.openedId ? 'Opened' : ago(r.pushedAt)}
              </span>
            </button>
          </li>
        ))}
        {!shown.length && (
          <li className="px-4 py-6 text-center text-ink-soft">
            {repos.length ? 'No repo matches that.' : 'No repos on this GitHub account yet.'}
          </li>
        )}
      </ul>
    </div>
  )
}
