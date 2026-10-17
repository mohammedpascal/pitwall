import { Link } from '@tanstack/react-router'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { listFolders } from '#/server/fns'

export function PageHeader({ back, children }: { back?: boolean; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-8 py-4 max-sm:px-4">
      {back ? (
        <Link to="/" className="inline-flex items-center gap-1.5 text-[13px] font-medium hover:underline">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Projects
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

/** Path input that suggests subfolders as you type. */
export function FolderInput({
  id,
  value,
  onChange,
  autoFocus,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}) {
  const listId = useId()
  const [suggestions, setSuggestions] = useState<string[]>([])

  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      listFolders({ data: { input: value } })
        .then((list) => live && setSuggestions(list))
        .catch(() => live && setSuggestions([]))
    }, 120)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [value])

  return (
    <>
      <input
        id={id}
        list={listId}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        placeholder="~/src/my-project"
        className="h-11 w-full rounded-[10px] border border-line bg-surface px-3 font-mono text-[13px] outline-none focus:border-ink"
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  )
}
