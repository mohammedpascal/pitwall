import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import {
  FolderInput,
  ServicesEditor,
  errorMessage,
  nextRowKey,
  savedRows,
  toRows,
  type ServiceRow,
} from '#/components/ServicesEditor'
import { ErrorNote, Notes, PageHeader } from '#/components/ui'
import { getEditableProject, removeProject, scanProject, updateProject } from '#/server/fns'

export const Route = createFileRoute('/p/$projectId_/settings')({
  loader: async ({ params }) => {
    const project = await getEditableProject({ data: { projectId: params.projectId } })
    if (!project) throw notFound()
    return project
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.name} settings · Pitwall` : 'Settings · Pitwall' }],
  }),
  component: Settings,
})

function Settings() {
  const project = Route.useLoaderData()
  const navigate = useNavigate()
  const [name, setName] = useState(project.name)
  const [folder, setFolder] = useState(project.path)
  const [rows, setRows] = useState<ServiceRow[]>(() =>
    toRows(project.services.map((s) => ({ ...s, kind: '', enabled: true }))),
  )
  const [busy, setBusy] = useState<'save' | 'scan' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)

  const back = { to: '/p/$projectId' as const, params: { projectId: project.id }, label: project.name }

  // Services that will stop because they're removed or switched off here.
  const keptIds = new Set(savedRows(rows).map((r) => r.id).filter(Boolean))
  const stopping = project.services.filter((s) => project.running.includes(s.id) && !keptIds.has(s.id))

  async function save() {
    if (busy) return
    setBusy('save')
    setError(null)
    try {
      await updateProject({
        data: { id: project.id, name, path: folder, services: savedRows(rows) },
      })
      await navigate({ to: '/p/$projectId', params: { projectId: project.id } })
    } catch (e) {
      setError(errorMessage(e))
      setBusy(null)
    }
  }

  /** Scan the folder and add any services that aren't in the list yet (switched off). */
  async function findNew() {
    if (busy) return
    setBusy('scan')
    setError(null)
    try {
      const scan = await scanProject({ data: { path: folder } })
      const have = new Set(rows.map((r) => `${r.cwd || '.'}|${r.command}`))
      const haveCwd = new Set(rows.map((r) => r.cwd || '.'))
      const fresh = scan.services.filter(
        (s) => !have.has(`${s.cwd || '.'}|${s.command}`) && !(s.enabled && haveCwd.has(s.cwd || '.')),
      )
      if (fresh.length) {
        setRows((rs) => [...rs, ...fresh.map((s) => ({ ...s, id: '', enabled: false, key: nextRowKey() }))])
      }
      setNotes([
        fresh.length
          ? `Found ${fresh.length} more service${fresh.length === 1 ? '' : 's'}. They’re added below, switched off.`
          : 'No new services found in this folder.',
      ])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (busy) return
    setBusy('remove')
    setError(null)
    try {
      await removeProject({ data: { projectId: project.id } })
      await navigate({ to: '/' })
    } catch (e) {
      setError(errorMessage(e))
      setBusy(null)
    }
  }

  return (
    <div className="min-h-screen bg-bg text-sm text-ink">
      <PageHeader back={back} />

      <main className="mx-auto flex w-full max-w-[1040px] flex-col gap-6 px-8 pt-12 pb-16 max-sm:px-4">
        <h1 className="text-3xl font-semibold tracking-[-0.015em]">Project settings</h1>

        <div className="flex flex-wrap gap-4">
          <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1.5">
            <label htmlFor="pname" className="text-xs font-semibold text-ink-soft">
              Name
            </label>
            <input
              id="pname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11 rounded-[10px] border border-line bg-surface px-3 text-[15px] font-medium outline-none focus:border-ink"
            />
          </div>
          <div className="flex min-w-0 flex-[2_1_420px] flex-col gap-1.5">
            <label htmlFor="folder" className="text-xs font-semibold text-ink-soft">
              Folder
            </label>
            <FolderInput id="folder" value={folder} onChange={setFolder} />
          </div>
        </div>

        <ServicesEditor rows={rows} onChange={setRows} running={project.running} />

        <div className="-mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void findNew()}
            disabled={busy !== null || !folder.trim()}
            className="h-10 rounded-[10px] border border-line bg-surface px-4 font-medium hover:bg-line-soft disabled:opacity-50"
          >
            {busy === 'scan' ? 'Scanning…' : 'Scan folder for new services'}
          </button>
        </div>

        {notes.length > 0 && <Notes notes={notes} />}
        {error && <ErrorNote text={error} />}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <span className="text-[13px] text-ink-soft">
            {stopping.length
              ? `${stopping.map((s) => s.name).join(', ')} ${stopping.length === 1 ? 'is' : 'are'} running and will be stopped.`
              : project.running.length
                ? 'Running services keep their current command until you restart them.'
                : 'Changes are saved to pitwall.config.json.'}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void navigate({ to: '/p/$projectId', params: { projectId: project.id } })}
              className="h-11 rounded-[10px] border border-line bg-surface px-5 font-medium hover:bg-line-soft"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy !== null || !name.trim() || !folder.trim()}
              className="h-11 rounded-[10px] bg-ink px-5 font-semibold text-white hover:bg-ink/85 disabled:opacity-50"
            >
              {busy === 'save' ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>

        <section aria-labelledby="remove-h" className="mt-6 flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 id="remove-h" className="text-[15px] font-semibold">
                Remove project
              </h2>
              <p className="text-[13px] text-ink-soft">
                Takes {project.name} out of Pitwall. Nothing in {project.path} is touched.
              </p>
            </div>
            {!confirming && (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="h-10 rounded-[10px] border border-err/40 px-4 font-medium text-err hover:bg-err-tint"
              >
                Remove project…
              </button>
            )}
          </div>

          {confirming && (
            <div role="alertdialog" aria-labelledby="confirm-h" className="flex flex-col gap-3 rounded-xl bg-err-tint p-4">
              <p id="confirm-h" className="font-semibold">
                Remove {project.name}?
              </p>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px]">
                {project.running.length > 0 && (
                  <li>
                    {project.running.length} running service{project.running.length === 1 ? '' : 's'} will be stopped.
                  </li>
                )}
                {project.taskCount > 0 && (
                  <li>
                    Its {project.taskCount} task{project.taskCount === 1 ? '' : 's'} will be deleted.
                  </li>
                )}
                <li>You can add the folder again any time.</li>
              </ul>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="h-10 rounded-[10px] border border-line bg-surface px-4 font-medium hover:bg-line-soft"
                >
                  Keep it
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => void remove()}
                  disabled={busy !== null}
                  className="h-10 rounded-[10px] bg-err px-4 font-semibold text-white hover:bg-err/90 disabled:opacity-50"
                >
                  {busy === 'remove' ? 'Removing…' : 'Remove project'}
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
