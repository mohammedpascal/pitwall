import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ErrorNote, Notes, PageHeader } from '#/components/ui'
import {
  FolderInput,
  ServicesEditor,
  errorMessage,
  savedRows,
  toRows,
  type ServiceRow,
} from '#/components/ServicesEditor'
import { addProject, getProjects, scanProject } from '#/server/fns'
import type { ScanResult } from '#/server/types'

export const Route = createFileRoute('/new')({
  loader: async () => ({ projects: await getProjects() }),
  head: () => ({ meta: [{ title: 'Add project · Pitwall' }] }),
  component: AddProject,
})

function AddProject() {
  const { projects } = Route.useLoaderData()
  const navigate = useNavigate()
  const [folder, setFolder] = useState('~/src/')
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [name, setName] = useState('')
  const [rows, setRows] = useState<ServiceRow[]>([])
  const [busy, setBusy] = useState<'scan' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runScan() {
    if (!folder.trim() || busy) return
    setBusy('scan')
    setError(null)
    try {
      const result = await scanProject({ data: { path: folder } })
      setScan(result)
      setName(result.suggestedName)
      setRows(toRows(result.services))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    if (!scan || busy) return
    setBusy('save')
    setError(null)
    try {
      const { id } = await addProject({
        data: { id: scan.suggestedId, name, path: scan.path, services: savedRows(rows) },
      })
      await navigate({ to: '/p/$projectId', params: { projectId: id } })
    } catch (e) {
      setError(errorMessage(e))
      setBusy(null)
    }
  }

  const count = savedRows(rows).length
  const step = scan ? 2 : 1

  return (
    <div className="min-h-screen bg-bg text-sm text-ink">
      <PageHeader back={projects.length > 0 ? { to: '/', label: 'Projects' } : undefined}>
        <ol aria-label="Progress" className="flex gap-5 text-[13px]">
          {['Choose folder', 'Confirm services'].map((label, i) => {
            const n = i + 1
            const on = n <= step
            return (
              <li
                key={label}
                aria-current={n === step ? 'step' : undefined}
                className={`inline-flex items-center gap-2 ${n === step ? 'font-semibold' : on ? '' : 'text-ink-soft'}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex size-5 items-center justify-center rounded-full text-[11px] font-semibold ${on ? 'bg-ink text-white' : 'border border-line'}`}
                >
                  {n}
                </span>
                {label}
              </li>
            )
          })}
        </ol>
      </PageHeader>

      <main className="mx-auto flex w-full max-w-[1040px] flex-col gap-6 px-8 pt-12 pb-16 max-sm:px-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-[-0.015em]">
            {scan ? `Found ${rows.length} service${rows.length === 1 ? '' : 's'} in ${scan.displayPath}` : 'Add a project'}
          </h1>
          <p className="max-w-[620px] text-[15px] leading-relaxed text-ink-soft">
            {scan
              ? 'Check how each one should run. Turn off anything you don’t need, fix a command, or add one I missed.'
              : 'Point Pitwall at a project folder. It reads the workspaces, apps and compose file and suggests how to run each service.'}
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void runScan()
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-1.5">
            <label htmlFor="folder" className="text-xs font-semibold text-ink-soft">
              Project folder
            </label>
            <FolderInput
              id="folder"
              value={folder}
              onChange={(v) => {
                setFolder(v)
                if (scan) setScan(null)
              }}
            />
          </div>
          <button
            type="submit"
            disabled={!folder.trim() || busy !== null}
            className={`h-11 rounded-[10px] px-5 font-semibold disabled:opacity-50 ${scan ? 'border border-line bg-surface hover:bg-line-soft' : 'bg-ink text-white hover:bg-ink/85'}`}
          >
            {busy === 'scan' ? 'Scanning…' : scan ? 'Scan again' : 'Scan folder'}
          </button>
        </form>

        {error && <ErrorNote text={error} />}

        {scan && (
          <>
            <div className="flex max-w-[420px] flex-col gap-1.5">
              <label htmlFor="pname" className="text-xs font-semibold text-ink-soft">
                Project name
              </label>
              <input
                id="pname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11 rounded-[10px] border border-line bg-surface px-3 text-[15px] font-medium outline-none focus:border-ink"
              />
            </div>

            <ServicesEditor
              rows={rows}
              onChange={setRows}
              meta={`${scan.packageManager}${scan.portless ? ' · portless' : ''}`}
            />

            {scan.notes.length > 0 && <Notes notes={scan.notes} />}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
              <span className="text-[13px] text-ink-soft">
                Saved to <code className="font-mono text-ink">pitwall.config.json</code>. You can change it later in the project’s settings.
              </span>
              <button
                type="button"
                onClick={() => void save()}
                disabled={!name.trim() || busy !== null}
                className="h-11 rounded-[10px] bg-ink px-5 font-semibold text-white hover:bg-ink/85 disabled:opacity-50"
              >
                {busy === 'save' ? 'Adding…' : `Add project${count ? ` with ${count} service${count === 1 ? '' : 's'}` : ''}`}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
