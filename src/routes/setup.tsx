import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Setup } from '#/components/Setup'
import { PageHeader } from '#/components/ui'
import { finishSetup, getSetup } from '#/server/fns'

export const Route = createFileRoute('/setup')({
  loader: async () => {
    const setup = await getSetup()
    // Only a new cloud machine starts here; after that, Settings opens as a dialog.
    if (!setup.cloud) throw redirect({ to: '/' })
    return { setup }
  },
  head: () => ({ meta: [{ title: 'Set up · Pitwall' }] }),
  component: SetupPage,
})

function SetupPage() {
  const { setup } = Route.useLoaderData()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  async function done() {
    setBusy(true)
    await finishSetup().catch(() => {})
    await navigate({ to: '/' })
  }

  return (
    <div className="min-h-screen bg-bg text-sm text-ink">
      {/* No way back but Continue: until then, / brings you here again. */}
      <PageHeader />
      <main className="mx-auto flex w-full max-w-[620px] flex-col gap-6 px-6 pt-24 pb-16 max-sm:pt-12">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-[-0.015em]">Set up this machine</h1>
          <p className="text-[15px] leading-relaxed text-ink-soft">
            Claude works on your tasks here, GitHub lets it clone and push, and a dev domain gives each app an address.
            Do them now or whenever you need them.
          </p>
        </div>
        <Setup initial={setup} />
        <button
          type="button"
          onClick={() => void done()}
          disabled={busy}
          className="h-11 self-start rounded-[10px] border border-line bg-surface px-5 font-semibold hover:border-ink disabled:opacity-50"
        >
          Continue to Pitwall
        </button>
      </main>
    </div>
  )
}
