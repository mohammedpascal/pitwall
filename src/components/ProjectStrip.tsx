import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import type { ProjectSummary } from '#/server/types'
import { PlusIcon } from './icons'
import { Menu } from './Menu'

/** What needs you first, then what's running, then the rest; config order within each. */
const rank = (p: ProjectSummary) => (p.needsYou > 0 ? 0 : p.running > 0 ? 1 : 2)

const describe = (p: ProjectSummary) =>
  [p.needsYou ? `${p.needsYou} need${p.needsYou === 1 ? 's' : ''} you` : '', p.running ? 'running' : 'stopped']
    .filter(Boolean)
    .join(' · ')

/** Every project as a tab above the page: one click switches. */
export function ProjectStrip({
  projects,
  current,
  cloud = false,
}: {
  projects: ProjectSummary[]
  current: string
  /** Behind a login: offer Setup and Sign out. */
  cloud?: boolean
}) {
  const navigate = useNavigate()
  const sorted = projects.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p)
  const strip = useRef<HTMLDivElement>(null)
  const signOut = useRef<HTMLFormElement>(null)
  // Tabs cut off at the edge; they're also in "+N more".
  const [hidden, setHidden] = useState<string[]>([])

  const ids = sorted.map((p) => p.id).join('|')
  useEffect(() => {
    const root = strip.current
    if (!root) return
    const out = new Set<string>()
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.id!
          if (e.intersectionRatio >= 0.99) out.delete(id)
          else out.add(id)
        }
        setHidden([...out])
      },
      { root, threshold: [0, 0.99] },
    )
    root.querySelectorAll<HTMLElement>('[data-id]').forEach((el) => seen.observe(el))
    return () => seen.disconnect()
  }, [ids])

  // Keep the project you're in visible: on opening it, and when the window narrows.
  useEffect(() => {
    const root = strip.current
    if (!root) return
    const show = () => {
      const chip = root.querySelector<HTMLElement>('[aria-current="page"]')
      if (!chip) return
      const left = chip.offsetLeft - root.offsetLeft
      if (left < root.scrollLeft || left + chip.offsetWidth > root.scrollLeft + root.clientWidth - 24) {
        root.scrollTo({ left: Math.max(0, left - 8) })
      }
    }
    show()
    const resized = new ResizeObserver(show)
    resized.observe(root)
    return () => resized.disconnect()
  }, [current, ids])

  const more = sorted.filter((p) => hidden.includes(p.id))
  // Tabs on one rule: the project you're in is the bold one, underlined where it meets the page.
  const tab = 'relative flex h-10 flex-none items-center gap-2 px-3 text-[14px]'

  return (
    <nav aria-label="Projects" className="flex min-w-0 items-center gap-2 border-b border-line">
      <div
        ref={strip}
        className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {sorted.map((p) => {
          const active = p.id === current
          return (
            <Link
              key={p.id}
              data-id={p.id}
              to="/p/$projectId"
              params={{ projectId: p.id }}
              aria-current={active ? 'page' : undefined}
              aria-label={`${p.name}, ${describe(p)}`}
              title={p.name}
              className={`${tab} ${
                active
                  ? 'font-semibold text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-ink'
                  : 'font-medium text-ink-soft hover:text-ink'
              }`}
            >
              <span
                aria-hidden="true"
                className={`size-[9px] flex-none rounded-full ${p.running ? 'bg-ok' : 'border-[1.5px] border-ink-faint'}`}
              />
              <span className="max-w-[220px] truncate">{p.name}</span>
              {p.needsYou > 0 && (
                <span
                  aria-hidden="true"
                  className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ink px-1.5 text-[11px] leading-none font-bold text-white"
                >
                  {p.needsYou > 99 ? '99+' : p.needsYou}
                </span>
              )}
            </Link>
          )
        })}
        {/* Room for the fade, so the last chip can scroll fully into view. */}
        <span aria-hidden="true" className="w-4 flex-none" />
      </div>

      {more.length > 0 && (
        <Menu
          label={`${more.length} more project${more.length === 1 ? '' : 's'}`}
          trigger={<span>+{more.length} more</span>}
          triggerClassName={`${tab} font-medium text-ink-soft hover:text-ink`}
          items={more.map((p) => ({
            label: p.name,
            hint: describe(p),
            onSelect: () => void navigate({ to: '/p/$projectId', params: { projectId: p.id } }),
          }))}
        />
      )}
      <Link
        to="/new"
        aria-label="Add project"
        title="Add project"
        className="flex size-9 flex-none items-center justify-center rounded-lg text-ink-soft hover:bg-line-soft hover:text-ink"
      >
        <PlusIcon />
      </Link>
      {cloud && (
        <>
          <Menu
            label="Pitwall"
            items={[
              { label: 'Set up this machine', onSelect: () => void navigate({ to: '/setup' }) },
              { label: 'Sign out', onSelect: () => signOut.current?.submit() },
            ]}
          />
          <form ref={signOut} method="post" action="/api/auth/logout" hidden />
        </>
      )}
    </nav>
  )
}
