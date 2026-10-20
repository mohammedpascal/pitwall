import { useEffect, useRef, useState, type ReactNode } from 'react'
import { errorMessage } from '#/lib/errors'
import { closeSettings, useSettingsOpen } from '#/lib/settings'
import { checkDomain, finishClaudeSignIn, getSetup, setLoginPassword, startSignIn, switchDomain } from '#/server/fns'
import { ErrorNote } from './ui'

export type SetupState = Awaited<ReturnType<typeof getSetup>>

/**
 * Settings, over whatever page you're on. Only ✕ and Escape close it: a stray click outside, on the way back from
 * GitHub or your DNS provider, shouldn't. A new cloud machine sees the same rows as the /setup page instead.
 */
export function SettingsDialog() {
  const open = useSettingsOpen()
  const ref = useRef<HTMLDialogElement>(null)
  const [state, setState] = useState<SetupState | null>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      // Fresh each time: you may have signed in elsewhere since.
      setState(null)
      void getSetup()
        .then(setState)
        .catch(() => {})
    } else if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby="settings-h"
      onClose={closeSettings}
      className="m-auto w-[min(620px,calc(100vw-32px))] rounded-2xl border border-line bg-bg p-0 text-sm text-ink backdrop:bg-ink/30"
    >
      <div className="flex max-h-[min(720px,calc(100vh-64px))] flex-col gap-4 overflow-y-auto p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 id="settings-h" className="text-xl font-semibold tracking-[-0.01em]">
            Settings
          </h2>
          <button
            type="button"
            onClick={closeSettings}
            aria-label="Close"
            className="flex size-9 items-center justify-center rounded-lg text-ink-soft hover:bg-line-soft hover:text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {open && (state ? <Setup initial={state} /> : <p className="text-ink-soft">Loading…</p>)}
      </div>
    </dialog>
  )
}

const POLL_MS = 2_000
const DNS_POLL_MS = 3_000

const button =
  'h-9 flex-none rounded-[10px] bg-ink px-4 text-[13px] font-semibold text-white hover:bg-ink/85 disabled:opacity-50'
// The next step gets the solid button; a later one waits its turn in outline.
const later =
  'h-9 flex-none rounded-[10px] border border-line px-4 text-[13px] font-semibold hover:border-ink disabled:opacity-50'

/** The three things a cloud machine needs: Claude, GitHub and a dev domain. Each row turns green when done. */
export function Setup({ initial }: { initial: SetupState }) {
  const [state, setState] = useState(initial)
  const [busy, setBusy] = useState<'claude' | 'github' | 'code' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('')

  const refresh = () =>
    getSetup()
      .then(setState)
      .catch(() => {})

  // GitHub finishes on its own once you approve the code there.
  const waiting = !!state.signIn.github.code
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [waiting])

  async function signInToClaude() {
    // Opened now, while it still counts as your click; the link fills in when it's ready.
    const tab = window.open('', '_blank')
    setBusy('claude')
    setError(null)
    try {
      const { url } = await startSignIn({ data: { to: 'claude' } })
      if (tab && url) tab.location.href = url
      await refresh()
    } catch (e) {
      tab?.close()
      setError(errorMessage(e))
    }
    setBusy(null)
  }

  async function sendCode() {
    setBusy('code')
    setError(null)
    try {
      await finishClaudeSignIn({ data: { code } })
      setCode('')
    } catch (e) {
      setError(errorMessage(e))
    }
    await refresh()
    setBusy(null)
  }

  async function signInToGithub() {
    setBusy('github')
    setError(null)
    try {
      await startSignIn({ data: { to: 'github' } })
      await refresh()
    } catch (e) {
      setError(errorMessage(e))
    }
    setBusy(null)
  }

  const { claude, github } = state.signIn

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 pt-1">

      <Row name="Claude" why="For tasks" ok={claude.ok} who={claude.who}>
        {claude.url ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void sendCode()
            }}
            className="flex w-full flex-col gap-2"
          >
            <p className="text-[13px] text-ink-soft">
              Sign in on the{' '}
              <a href={claude.url} target="_blank" rel="noreferrer" className="font-medium text-ink underline">
                Claude page
              </a>
              , then paste the code it shows.
            </p>
            <div className="flex gap-2">
              <label htmlFor="claude-code" className="sr-only">
                Code from Claude
              </label>
              <input
                id="claude-code"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                placeholder="Paste the code"
                className="h-9 min-w-0 flex-1 rounded-[10px] border border-line bg-surface px-3 font-mono text-[13px] outline-none focus:border-ink"
              />
              <button type="submit" disabled={!code.trim() || !!busy} className={button}>
                {busy === 'code' ? 'Signing in…' : 'Done'}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => void signInToClaude()} disabled={!!busy} className={button}>
            {busy === 'claude' ? 'Opening…' : 'Sign in'}
          </button>
        )}
      </Row>

      <Row name="GitHub" why="For cloning and pushing" ok={github.ok} who={github.who}>
        {github.code && github.url ? (
          <div className="flex w-full flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xl font-semibold tracking-[0.12em]">{github.code}</span>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(github.code!)}
                className="h-8 rounded-lg border border-line px-2.5 text-xs font-medium hover:border-ink"
              >
                Copy
              </button>
            </div>
            <p className="text-[13px] text-ink-soft">
              Enter it at{' '}
              <a href={github.url} target="_blank" rel="noreferrer" className="font-medium text-ink underline">
                github.com/login/device ↗
              </a>
              . This turns green once you approve it.
            </p>
          </div>
        ) : (
          <button type="button" onClick={() => void signInToGithub()} disabled={!!busy} className={claude.ok ? button : later}>
            {busy === 'github' ? 'Starting…' : 'Sign in'}
          </button>
        )}
      </Row>

      {(error ?? claude.error ?? github.error) && <ErrorNote text={(error ?? claude.error ?? github.error)!} />}

      {state.cloud ? (
        <>
          <DomainRow domain={state.domain} next={claude.ok && github.ok} />
          <PasswordRow set={state.password} onSaved={() => void refresh()} />
        </>
      ) : (
        // Here every app gets a .localhost address by itself.
        <Row name="Dev domain" why="To open your apps" ok who="*.localhost">
          {null}
        </Row>
      )}
    </section>
  )
}

type Check = Awaited<ReturnType<typeof checkDomain>>

/** Type a domain, add the one DNS record it shows, then move Pitwall there once it points here. */
/** Optional: a password signs you in from other devices, where you don't have the link. */
function PasswordRow({ set, onSaved }: { set: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await setLoginPassword({ data: { password: value } })
      setValue('')
      setEditing(false)
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
    setBusy(false)
  }

  const why = 'To sign in from other devices'
  if (set && !editing) {
    return (
      <Row
        name="Password"
        why={why}
        ok
        who="Set"
        action={
          <button type="button" onClick={() => setEditing(true)} className="text-[13px] font-medium text-ink-soft hover:text-ink hover:underline">
            Change
          </button>
        }
      >
        {null}
      </Row>
    )
  }
  return (
    <Row name="Password" why={why} ok={false} who={null}>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
          className="flex w-full flex-col gap-2"
        >
          <div className="flex gap-2">
            <label htmlFor="login-password" className="sr-only">
              New password
            </label>
            <input
              id="login-password"
              type={shown ? 'text' : 'password'}
              autoFocus
              autoComplete="new-password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="At least 12 characters"
              className="h-9 min-w-0 flex-1 rounded-[10px] border border-line bg-surface px-3 font-mono text-[13px] outline-none focus:border-ink"
            />
            <button
              type="button"
              onClick={() => setShown((v) => !v)}
              className="h-9 flex-none rounded-[10px] px-2 text-xs font-medium text-ink-soft hover:text-ink"
            >
              {shown ? 'Hide' : 'Show'}
            </button>
            <button type="submit" disabled={busy || value.length < 12} className={button}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
          {error && <ErrorNote text={error} />}
        </form>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className={later}>
          Set a password
        </button>
      )}
    </Row>
  )
}

function DomainRow({ domain, next }: { domain: string | null; next: boolean }) {
  const [editing, setEditing] = useState(!domain)
  const [input, setInput] = useState('')
  const [check, setCheck] = useState<Check | null>(null)
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Checked shortly after you stop typing, then every few seconds until the record shows up.
  useEffect(() => {
    setCheck(null)
    setError(null)
    const typed = input.trim()
    if (!editing || !/\.[a-z]{2,}$/i.test(typed)) return
    let live = true
    let timer: ReturnType<typeof setTimeout>
    const run = () =>
      checkDomain({ data: { domain: typed } })
        .then((c) => {
          if (!live) return
          setCheck(c)
          if (!c.ok) timer = setTimeout(run, DNS_POLL_MS)
        })
        .catch((e) => live && setError(errorMessage(e)))
    timer = setTimeout(run, 600)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [input, editing])

  async function move() {
    if (!check?.ok) return
    setMoving(true)
    setError(null)
    try {
      const { url } = await switchDomain({ data: { domain: check.domain } })
      window.location.href = url
    } catch (e) {
      setError(errorMessage(e))
      setMoving(false)
    }
  }

  if (domain && !editing) {
    return (
      <Row
        name="Dev domain"
        why="To open your apps"
        ok
        who={`pitwall.${domain}`}
        action={
          <button type="button" onClick={() => setEditing(true)} className="text-[13px] font-medium text-ink-soft hover:text-ink hover:underline">
            Change
          </button>
        }
      >
        {null}
      </Row>
    )
  }

  const record = check ? `*.${check.domain}` : null
  return (
    <Row name="Dev domain" why="To open your apps" ok={false} who={null}>
      <div className="flex w-full flex-col gap-2">
        <label htmlFor="dev-domain" className="sr-only">
          Dev domain
        </label>
        <input
          id="dev-domain"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder="dev.example.com"
          className="h-9 w-full rounded-[10px] border border-line bg-surface px-3 font-mono text-[13px] outline-none focus:border-ink"
        />
        {check?.ok && (
          <>
            <p className="text-[13px] font-medium text-ok">{record} points at this server.</p>
            <button type="button" onClick={() => void move()} disabled={moving} className={`${next ? button : later} self-start`}>
              {moving ? 'Moving…' : `Move to pitwall.${check.domain}`}
            </button>
          </>
        )}
        {check && !check.ok && (
          <>
            <p className="text-[13px] text-ink-soft">Add this record at your DNS provider:</p>
            <div className="flex items-center gap-2 rounded-[10px] bg-bg px-3 py-2 font-mono text-[13px]">
              <span className="min-w-0 flex-1 break-all">
                {record} &nbsp;A&nbsp; {check.ip ?? 'this server’s IP'}
              </span>
              {check.ip && (
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(check.ip!)}
                  className="h-7 flex-none rounded-lg border border-line bg-surface px-2 text-xs font-medium hover:border-ink"
                >
                  Copy IP
                </button>
              )}
            </div>
            <p className="text-[13px] text-ink-soft">
              {check.points ? `It points at ${check.points}, not ${check.ip}.` : 'Waiting for it to show up…'} This checks again by itself.
            </p>
          </>
        )}
        {error && <ErrorNote text={error} />}
      </div>
    </Row>
  )
}

function Row({
  name,
  why,
  ok,
  who,
  action,
  children,
}: {
  name: string
  why: string
  ok: boolean
  who: string | null
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-t border-line-soft pt-4 first:border-t-0">
      <div className="flex min-w-[140px] flex-col">
        <span className="text-[14px] font-semibold">{name}</span>
        <span className="text-xs text-ink-soft">{why}</span>
      </div>
      {ok ? (
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ok">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          {who ?? 'Signed in'}
          {action && <span className="ml-2">{action}</span>}
        </span>
      ) : (
        <div className="flex min-w-0 flex-1 justify-end">{children}</div>
      )}
    </div>
  )
}
