import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

type Back =
  | { to: '/'; label: string }
  | { to: '/p/$projectId'; params: { projectId: string }; label: string }

export function PageHeader({ back, children }: { back?: Back; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-8 py-4 max-sm:px-4">
      {back ? (
        <Link
          {...(back.to === '/' ? { to: '/' } : { to: '/p/$projectId', params: back.params })}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium hover:underline"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {back.label}
        </Link>
      ) : (
        <span className="text-[15px] font-semibold">pitwall</span>
      )}
      {children}
    </header>
  )
}

export function ErrorNote({ text }: { text: string }) {
  return (
    <p role="alert" className="rounded-xl border border-err/30 bg-err-tint px-4 py-3 text-[13px] text-err">
      {text}
    </p>
  )
}

export function Notes({ notes }: { notes: string[] }) {
  return (
    <ul className="flex flex-col gap-1.5 text-[13px] text-ink-soft">
      {notes.map((n) => (
        <li key={n} className="flex gap-2">
          <span aria-hidden="true">·</span>
          {n}
        </li>
      ))}
    </ul>
  )
}
