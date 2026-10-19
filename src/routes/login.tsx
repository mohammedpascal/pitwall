import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { TerminalIcon } from '#/components/icons'

const ERRORS: Record<string, string> = {
  wrong: 'That password isn’t right.',
  wait: 'Too many tries. Wait a minute, then try again.',
  link: 'That link was already used or has expired.',
}

export const Route = createFileRoute('/login')({
  validateSearch: (s: Record<string, unknown>): { error?: string } => (typeof s.error === 'string' ? { error: s.error } : {}),
  head: () => ({ meta: [{ title: 'Sign in · Pitwall' }] }),
  component: Login,
})

/** A link always signs you in; a password does too, once you've set one in Setup. */
function Login() {
  const { error } = Route.useSearch()
  const problem = error ? (ERRORS[error] ?? 'Couldn’t sign in.') : null
  const [password, setPassword] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/auth/info')
      .then((r) => r.json() as Promise<{ password: boolean }>)
      .then((i) => setPassword(i.password))
      .catch(() => setPassword(false))
  }, [])

  const command = <code className="rounded-md bg-line-soft px-1.5 py-0.5 font-mono text-[13px] text-ink">sudo pitwall link</code>

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4 text-sm text-ink">
      <div className="flex w-full max-w-[380px] flex-col gap-4">
        <div className="mb-2 flex items-center gap-3">
          <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-[10px] bg-ink text-white">
            <TerminalIcon size={18} />
          </span>
          <h1 className="text-2xl font-semibold tracking-[-0.015em]">Pitwall</h1>
        </div>

        {password ? (
          // A plain form post, so signing in works before the page's script has loaded.
          <form method="post" action="/api/auth/login" className="flex flex-col gap-4">
            <label htmlFor="password" className="text-[13px] font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              aria-invalid={error === 'wrong'}
              aria-describedby={problem ? 'login-error' : undefined}
              className={`-mt-2 h-11 rounded-[10px] border bg-surface px-3 font-mono text-[13px] outline-none focus:border-ink ${
                error === 'wrong' ? 'border-err' : 'border-line'
              }`}
            />
            {problem && (
              <p id="login-error" role="alert" className="-mt-1 text-[13px] text-err">
                {problem}
              </p>
            )}
            <button type="submit" className="h-11 rounded-[10px] bg-ink font-medium text-white hover:bg-ink/85">
              Sign in
            </button>
            <p className="text-xs leading-relaxed text-ink-soft">Or sign in with a link: run {command} on the server.</p>
          </form>
        ) : (
          <>
            {problem && (
              <p role="alert" className="text-[15px] font-medium text-err">
                {problem}
              </p>
            )}
            {password === false && (
              <>
                <p className="text-[15px] leading-relaxed text-ink-soft">
                  Sign in with the link the installer printed. Each link works once. For a new one, run this on the server:
                </p>
                <code className="rounded-[10px] border border-line bg-surface px-3 py-2.5 font-mono text-[13px]">sudo pitwall link</code>
                <p className="text-xs leading-relaxed text-ink-soft">Once you’re in, set a password in Setup to sign in from other devices.</p>
              </>
            )}
          </>
        )}
      </div>
    </main>
  )
}
