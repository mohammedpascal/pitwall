import { createFileRoute } from '@tanstack/react-router'
import { TerminalIcon } from '#/components/icons'

export const Route = createFileRoute('/login')({
  validateSearch: (s: Record<string, unknown>): { error?: string } => (typeof s.error === 'string' ? { error: s.error } : {}),
  head: () => ({ meta: [{ title: 'Sign in · Pitwall' }] }),
  component: Login,
})

/** No password: you sign in with a link printed on the server. */
function Login() {
  const { error } = Route.useSearch()
  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4 text-sm text-ink">
      <div className="flex w-full max-w-[380px] flex-col gap-4">
        <div className="mb-2 flex items-center gap-3">
          <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-[10px] bg-ink text-white">
            <TerminalIcon size={18} />
          </span>
          <h1 className="text-2xl font-semibold tracking-[-0.015em]">Pitwall</h1>
        </div>
        {error === 'link' && (
          <p role="alert" className="text-[15px] font-medium text-err">
            That link was already used or has expired.
          </p>
        )}
        <p className="text-[15px] leading-relaxed text-ink-soft">
          Sign in with the link the installer printed. Each link works once. For a new one, run this on the server:
        </p>
        <code className="rounded-[10px] border border-line bg-surface px-3 py-2.5 font-mono text-[13px]">sudo pitwall link</code>
      </div>
    </main>
  )
}
