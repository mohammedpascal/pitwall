import { useEffect, useId, useState } from 'react'
import { listFolders } from '#/server/fns'
import { PlusIcon } from './icons'

export interface ServiceRow {
  key: string
  /** Kept for existing services so running processes stay matched; '' for new rows. */
  id: string
  name: string
  command: string
  cwd: string
  kind: string
  enabled: boolean
}

let rowKey = 0
export const nextRowKey = () => `row-${++rowKey}`

export const toRows = (services: Omit<ServiceRow, 'key'>[]): ServiceRow[] =>
  services.map((s) => ({ ...s, key: nextRowKey() }))

/** Rows that will actually be saved. */
export const savedRows = (rows: ServiceRow[]) =>
  rows
    .filter((r) => r.enabled && r.name.trim() && r.command.trim())
    .map(({ id, name, command, cwd }) => ({ id, name, command, cwd }))

const GRID = 'grid grid-cols-[52px_minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)_40px] gap-3'

export function ServicesEditor({
  rows,
  onChange,
  meta,
  running = [],
}: {
  rows: ServiceRow[]
  onChange: (rows: ServiceRow[]) => void
  meta?: string
  running?: string[]
}) {
  const update = (key: string, patch: Partial<ServiceRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  return (
    <section aria-labelledby="svc-h" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="svc-h" className="text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase">
          Services
        </h2>
        {meta && <span className="text-xs text-ink-soft">{meta}</span>}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <div className="min-w-[760px]">
          <div className={`${GRID} border-b border-line px-4 py-3 text-xs font-semibold tracking-[0.06em] text-ink-soft uppercase`}>
            <span>Run</span>
            <span>Name</span>
            <span>Command</span>
            <span>Folder</span>
            <span className="sr-only">Remove</span>
          </div>
          {rows.length === 0 && (
            <p className="px-4 py-6 text-center text-ink-soft">No services yet. Add one below.</p>
          )}
          {rows.map((r) => {
            const isRunning = r.id !== '' && running.includes(r.id)
            return (
              <div
                key={r.key}
                className={`${GRID} items-center border-b border-line-soft px-4 py-3 last:border-b-0 ${r.enabled ? '' : 'opacity-55'}`}
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={r.enabled}
                  aria-label={`Include ${r.name || 'service'}`}
                  onClick={() => update(r.key, { enabled: !r.enabled })}
                  className={`flex h-6 w-10 rounded-full p-[3px] transition-colors ${r.enabled ? 'justify-end bg-ink' : 'justify-start bg-line'}`}
                >
                  <span aria-hidden="true" className="size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]" />
                </button>
                <div className="flex min-w-0 flex-col gap-1">
                  <input
                    aria-label="Service name"
                    value={r.name}
                    onChange={(e) => update(r.key, { name: e.target.value })}
                    placeholder="Name"
                    className="h-9 min-w-0 rounded-lg border border-transparent bg-transparent px-2 font-semibold outline-none hover:border-line focus:border-ink"
                  />
                  <span className="flex items-center gap-1.5 truncate px-2 text-xs text-ink-soft">
                    {isRunning && (
                      <span className="inline-flex items-center gap-1 text-ok">
                        <span aria-hidden="true" className="size-1.5 rounded-full bg-ok" />
                        Running
                      </span>
                    )}
                    {isRunning && r.kind && <span aria-hidden="true">·</span>}
                    {r.kind}
                  </span>
                </div>
                <input
                  aria-label={`${r.name || 'Service'} command`}
                  value={r.command}
                  onChange={(e) => update(r.key, { command: e.target.value })}
                  placeholder="npm run dev"
                  spellCheck={false}
                  className="h-9 min-w-0 rounded-lg border border-line bg-bg px-2.5 font-mono text-xs outline-none focus:border-ink"
                />
                <input
                  aria-label={`${r.name || 'Service'} folder`}
                  value={r.cwd}
                  onChange={(e) => update(r.key, { cwd: e.target.value })}
                  placeholder="."
                  spellCheck={false}
                  className="h-9 min-w-0 rounded-lg border border-line bg-bg px-2.5 font-mono text-xs outline-none focus:border-ink"
                />
                <button
                  type="button"
                  aria-label={`Remove ${r.name || 'service'}`}
                  onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-soft hover:bg-line-soft hover:text-ink"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={() =>
          onChange([
            ...rows,
            { key: nextRowKey(), id: '', name: '', command: '', cwd: '', kind: 'Added by you', enabled: true },
          ])
        }
        className="inline-flex h-10 items-center gap-2 self-start rounded-[10px] px-3 font-medium text-ink-soft hover:bg-line-soft hover:text-ink"
      >
        <PlusIcon size={16} />
        Add a service
      </button>
    </section>
  )
}

/** Path input that suggests subfolders as you type. */
export function FolderInput({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (value: string) => void
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

export function errorMessage(e: unknown) {
  const text = e instanceof Error ? e.message : String(e)
  return text || 'Something went wrong'
}
