import { useEffect, useRef, useState } from 'react'
import { ExternalIcon } from './icons'

const hiddenKey = (id: string) => `pitwall:preview-hidden:${id}`
const pathKey = (id: string) => `pitwall:preview-path:${id}`

function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: works for this visit only */
  }
}

/**
 * Turn what was typed into a URL, like a browser address bar:
 *  "/notes" or "notes?tab=2" → a page of this app
 *  "younote.localhost/notes" → that host, same protocol as the app
 *  "https://…"               → as typed
 * Empty goes back to the app's home page.
 */
function resolve(input: string, base: string): string | null {
  const text = input.trim()
  if (!text) return base
  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(text)) return new URL(text).toString()
    if (/^[/?#]/.test(text)) return new URL(text, base).toString()
    if (/^[^\s/]+\.[^\s/]+(\/|$)|^localhost(:\d+)?(\/|$)/i.test(text)) {
      return new URL(`${new URL(base).protocol}//${text}`).toString()
    }
    return new URL(`/${text}`, base).toString()
  } catch {
    return null
  }
}

const short = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

/** The running web app, embedded above its output, with an editable address. */
export function WebPreview({ id, name, url, embeddable }: { id: string; name: string; url: string; embeddable: boolean }) {
  const [reloads, setReloads] = useState(0)
  const [hidden, setHidden] = useState(false)
  const [current, setCurrent] = useState(url)
  const [draft, setDraft] = useState(url)
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  // New service or new run: start from the app, on the last page you went to in it.
  useEffect(() => {
    setHidden(read(hiddenKey(id)) === '1')
    const saved = read(pathKey(id))
    let start = url
    if (saved) {
      try {
        start = new URL(saved, url).toString()
      } catch {
        start = url
      }
    }
    setCurrent(start)
    setDraft(start)
  }, [id, url])

  function go() {
    const next = resolve(draft, url)
    if (!next) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setEditing(false)
    if (next === current) setReloads((n) => n + 1)
    setCurrent(next)
    setDraft(next)
    // Remember the page within this app; other sites aren't restored.
    const target = new URL(next)
    if (target.origin === new URL(url).origin) write(pathKey(id), target.pathname + target.search + target.hash)
    input.current?.blur()
  }

  function toggle() {
    setHidden((h) => {
      write(hiddenKey(id), h ? '0' : '1')
      return !h
    })
  }

  const iconButton =
    'flex size-8 flex-none items-center justify-center rounded-lg text-ink-soft hover:bg-line-soft hover:text-ink'

  return (
    <div className="flex flex-col border-b border-line">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          go()
        }}
        className="flex items-center gap-1.5 border-b border-line-soft bg-bg/60 px-2 py-1.5"
      >
        <label htmlFor={`preview-address-${id}`} className="sr-only">
          {name} preview address
        </label>
        <div
          className={`flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 ${
            invalid ? 'border-err' : editing ? 'border-ink bg-surface' : 'border-transparent hover:border-line'
          }`}
        >
          <span aria-hidden="true" className="size-2 flex-none rounded-full bg-ok" />
          <input
            ref={input}
            id={`preview-address-${id}`}
            value={editing ? draft : short(current)}
            onChange={(e) => {
              setDraft(e.target.value)
              setInvalid(false)
            }}
            onFocus={(e) => {
              setEditing(true)
              setDraft(current)
              requestAnimationFrame(() => e.target.select())
            }}
            onBlur={() => {
              setEditing(false)
              setInvalid(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraft(current)
                e.currentTarget.blur()
              }
            }}
            spellCheck={false}
            autoComplete="off"
            title={current}
            className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
          />
        </div>
        {embeddable && !hidden && (
          <button type="button" onClick={() => setReloads((n) => n + 1)} aria-label={`Reload ${name} preview`} title="Reload" className={iconButton}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        )}
        <a href={current} target="_blank" rel="noreferrer" aria-label={`Open ${name} in a new tab`} title="Open in a new tab" className={iconButton}>
          <ExternalIcon size={14} />
        </a>
        {embeddable && (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!hidden}
            className="h-8 flex-none rounded-lg px-2.5 text-xs font-medium text-ink-soft hover:bg-line-soft hover:text-ink"
          >
            {hidden ? 'Show preview' : 'Hide'}
          </button>
        )}
      </form>

      {!embeddable ? (
        <p className="px-4 py-3 text-[13px] text-ink-soft">
          {name} doesn’t allow being shown inside another page, so it opens in a new tab.
        </p>
      ) : (
        !hidden && (
          // Drag the bottom edge to make it taller or shorter.
          <div className="h-[520px] min-h-[200px] resize-y overflow-hidden bg-white">
            <iframe
              key={reloads}
              src={current}
              title={`${name} preview`}
              className="block h-full w-full border-0"
              allow="clipboard-read; clipboard-write"
            />
          </div>
        )
      )}
    </div>
  )
}
