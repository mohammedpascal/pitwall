import { Link } from '@tanstack/react-router'
import type { ProjectSummary } from '#/server/types'
import { PlusIcon, TerminalIcon } from './icons'

export function ProjectRail({
  projects,
  current,
  cloud = false,
}: {
  projects: ProjectSummary[]
  current: string
  /** Behind a login: offer to sign out. */
  cloud?: boolean
}) {
  return (
    <nav
      aria-label="Projects"
      className="flex max-w-full flex-[1_0_72px] flex-col items-center gap-2.5 border-r border-line bg-surface px-3 py-4 max-md:flex-row max-md:border-r-0 max-md:border-b"
    >
      <div
        aria-hidden="true"
        className="mb-2.5 flex size-9 items-center justify-center rounded-[10px] bg-ink text-white max-md:mb-0 max-md:mr-2"
      >
        <TerminalIcon size={18} />
      </div>
      {projects.map((p) => {
        const active = p.id === current
        return (
          <Link
            key={p.id}
            to="/p/$projectId"
            params={{ projectId: p.id }}
            aria-label={p.needsYou ? `${p.name}, ${p.needsYou} need${p.needsYou === 1 ? 's' : ''} you` : p.name}
            title={p.name}
            aria-current={active ? 'page' : undefined}
            className={`relative flex size-11 items-center justify-center rounded-xl border text-[15px] font-semibold transition-colors ${
              active
                ? 'border-ink bg-ink text-white'
                : 'border-line bg-surface text-ink hover:bg-line-soft'
            }`}
          >
            {p.name.slice(0, 1).toUpperCase()}
            {p.needsYou > 0 && (
              <span
                aria-hidden="true"
                className={`absolute -top-1.5 -left-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-surface px-1 text-[10px] leading-none font-bold ${
                  active ? 'bg-surface text-ink ring-1 ring-ink' : 'bg-ink text-white'
                }`}
              >
                {p.needsYou > 9 ? '9+' : p.needsYou}
              </span>
            )}
            {p.running > 0 && (
              <span
                aria-hidden="true"
                className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-surface bg-ok"
              />
            )}
          </Link>
        )
      })}
      <Link
        to="/new"
        aria-label="Add project"
        title="Add project"
        className="flex size-11 items-center justify-center rounded-xl border border-dashed border-ink-faint text-ink-soft transition-colors hover:border-ink hover:text-ink"
      >
        <PlusIcon />
      </Link>
      {cloud && (
        <form method="post" action="/api/auth/logout" className="mt-auto max-md:mt-0 max-md:ml-auto">
          <button
            type="submit"
            title="Sign out"
            aria-label="Sign out"
            className="flex size-11 items-center justify-center rounded-xl text-ink-soft transition-colors hover:bg-line-soft hover:text-ink"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </button>
        </form>
      )}
    </nav>
  )
}
