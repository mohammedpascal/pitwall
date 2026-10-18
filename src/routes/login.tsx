import { createFileRoute } from '@tanstack/react-router'
import { TerminalIcon } from '#/components/icons'

const ERRORS: Record<string, string> = {
  wrong: 'That password isn’t right.',
  wait: 'Too many tries. Wait a minute, then try again.',
}

export const Route = createFileRoute('/login')({
  validateSearch: (s: Record<string, unknown>): { next?: string; error?: string } => ({
    ...(typeof s.next === 'string' ? { next: s.next } : {}),
    ...(typeof s.error === 'string' ? { error: s.error } : {}),
  }),
  head: () => ({ meta: [{ title: 'Sign in · Pitwall' }] }),
  component: Login,
})

/** A plain form post, so signing in works before the page's script has loaded. */
function Login() {
  const { next, error } = Route.useSearch()
  const problem = error ? (ERRORS[error] ?? 'Couldn’t sign in.') : null
  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4 text-sm text-ink">
      <form method="post" action="/api/auth/login" className="flex w-full max-w-[360px] flex-col gap-4">
        <div className="mb-2 flex items-center gap-3">
          <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-[10px] bg-ink text-white">
            <TerminalIcon size={18} />
          </span>
          <h1 className="text-2xl font-semibold tracking-[-0.015em]">Pitwall</h1>
        </div>
        <input type="hidden" name="next" value={next ?? '/'} />
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
          aria-invalid={!!problem}
          aria-describedby={problem ? 'login-error' : undefined}
          className={`h-11 rounded-[10px] border bg-surface px-3 font-mono text-[13px] outline-none focus:border-ink ${
            problem ? 'border-err' : 'border-line'
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
        <p className="text-xs leading-relaxed text-ink-soft">
          The installer printed this password. Lost it? On the server, run{' '}
          <code className="font-mono">pitwall reset-password</code>.
        </p>
      </form>
    </main>
  )
}
