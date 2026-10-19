import { useEffect, useState, type ReactNode } from 'react'
import { errorMessage } from '#/lib/errors'
import { finishClaudeSignIn, getSignIn, startSignIn } from '#/server/fns'
import type { SignInStatus } from '#/server/signin'
import { ErrorNote } from './ui'

const POLL_MS = 2_000

const button =
  'h-9 flex-none rounded-[10px] bg-ink px-4 text-[13px] font-semibold text-white hover:bg-ink/85 disabled:opacity-50'
// The next step gets the solid button; a later one waits its turn in outline.
const later =
  'h-9 flex-none rounded-[10px] border border-line px-4 text-[13px] font-semibold hover:border-ink disabled:opacity-50'

/** Signs this machine in to Claude and GitHub; shown only until both are done. */
export function Connect({ initial }: { initial: SignInStatus | null }) {
  const [state, setState] = useState(initial)
  const [busy, setBusy] = useState<'claude' | 'github' | 'code' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('')

  const refresh = () =>
    getSignIn()
      .then(setState)
      .catch(() => {})

  // GitHub finishes on its own once you approve the code there.
  const waiting = !!state?.github.code
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [waiting])

  if (!state || (state.claude.ok && state.github.ok)) return null

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

  const { claude, github } = state

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-semibold">Sign in on this machine</h2>
        <p className="text-[13px] text-ink-soft">Claude works on your tasks here, and GitHub lets it clone and push.</p>
      </div>

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
    </section>
  )
}

function Row({ name, why, ok, who, children }: { name: string; why: string; ok: boolean; who: string | null; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-t border-line-soft pt-4">
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
        </span>
      ) : (
        <div className="flex min-w-0 flex-1 justify-end">{children}</div>
      )}
    </div>
  )
}
