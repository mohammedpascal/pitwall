import { useCallback, useEffect, useState } from 'react'
import { errorMessage } from '#/lib/errors'
import { addMcpServer, getTools, removeMcpServer } from '#/server/fns'
import type { McpServer, McpStatus, Skill } from '#/server/tools'
import { Menu } from './Menu'
import { ErrorNote } from './ui'

const SCOPE: Record<McpServer['scope'], string> = {
  project: 'This project',
  repo: 'In the repo',
  user: 'All projects',
  account: 'Your claude.ai account',
  plugin: 'A plugin',
}

const STATUS: Record<McpStatus, { dot: string; label: string }> = {
  connected: { dot: 'bg-ok', label: 'Connected' },
  failed: { dot: 'bg-err', label: 'Can’t connect' },
  'sign-in': { dot: 'bg-warn', label: 'Needs sign-in' },
  unchecked: { dot: 'border-[1.5px] border-ok', label: 'Used by tasks; not checked here' },
  unknown: { dot: 'border-[1.5px] border-ink-faint', label: 'Checking…' },
}

const button = 'h-8 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium hover:bg-line-soft disabled:opacity-50'
const input =
  'h-9 w-full rounded-[10px] border border-line bg-surface px-3 font-mono text-[13px] outline-none focus:border-ink'

/** What Claude can use in this project: its MCP servers and skills, and adding to them. */
export function ToolsView({
  projectId,
  onClose,
  onWriteSkill,
}: {
  projectId: string
  onClose: () => void
  /** Hands "write a skill that…" to Claude as a task. */
  onWriteSkill: (what: string) => Promise<void>
}) {
  const [servers, setServers] = useState<McpServer[] | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [writing, setWriting] = useState(false)

  const load = useCallback(
    (fresh = false) =>
      getTools({ data: { projectId, fresh } })
        .then((t) => {
          setServers(t.servers)
          setSkills(t.skills)
        })
        .catch((e) => setError(errorMessage(e))),
    [projectId],
  )
  useEffect(() => {
    void load()
  }, [load])

  async function act(fn: () => Promise<unknown>) {
    setError(null)
    try {
      await fn()
      await load(true)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <section aria-labelledby="tools-h" className="flex flex-grow flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase hover:text-ink"
        >
          ← Output
        </button>
      </div>
      <h2 id="tools-h" className="text-xl font-semibold">
        MCP & Skills
      </h2>
      {error && <ErrorNote text={error} />}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase">MCP servers</h3>
          {!adding && (
            <button type="button" onClick={() => setAdding(true)} className={button}>
              Add a server
            </button>
          )}
        </div>
        {adding && (
          <AddServer
            onCancel={() => setAdding(false)}
            onAdd={(s) =>
              act(async () => {
                await addMcpServer({ data: { projectId, ...s } })
                setAdding(false)
              })
            }
          />
        )}
        <ul className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
          {servers === null && <li className="px-4 py-4 text-ink-soft">Checking the servers…</li>}
          {servers?.length === 0 && <li className="px-4 py-4 text-ink-soft">No MCP servers yet.</li>}
          {servers?.map((s) => (
            <li key={`${s.scope}:${s.name}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft px-4 py-3 first:border-t-0">
              <span aria-hidden="true" className={`size-[9px] flex-none rounded-full ${STATUS[s.status].dot}`} />
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{s.name}</span>
                <span className="ml-2 font-mono text-xs text-ink-soft">{s.where}</span>
                <span className="block text-xs text-ink-soft">
                  {SCOPE[s.scope]} · {STATUS[s.status].label}
                  {s.reason && ` — ${s.reason}`}
                  {s.status === 'sign-in' && ` — run claude mcp login ${s.name} on this machine, or use Remote control on a task`}
                </span>
              </span>
              {s.scope === 'project' && (
                <Menu
                  label={`${s.name} options`}
                  size="sm"
                  items={[{ label: 'Remove', danger: true, onSelect: () => void act(() => removeMcpServer({ data: { projectId, name: s.name } })) }]}
                />
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase">Skills</h3>
          {!writing && (
            <button type="button" onClick={() => setWriting(true)} className={button}>
              Write a skill
            </button>
          )}
        </div>
        {writing && (
          <WriteSkill
            onCancel={() => setWriting(false)}
            onWrite={async (what) => {
              await onWriteSkill(what)
              setWriting(false)
            }}
          />
        )}
        <p className="text-[13px] text-ink-soft">
          Claude uses these when a task fits. To run one yourself, start a task with <span className="font-mono">/</span> and its name.
        </p>
        <ul className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
          {skills.length === 0 && <li className="px-4 py-4 text-ink-soft">No skills yet.</li>}
          {skills.map((s) => (
            <li key={`${s.scope}:${s.name}`} className="border-t border-line-soft px-4 py-3 first:border-t-0">
              <span className="font-mono text-[13px] font-semibold">/{s.name}</span>
              <span className="ml-2 text-xs text-ink-soft">{s.scope === 'repo' ? 'This repo' : 'Personal'}</span>
              {s.description && <span className="mt-0.5 line-clamp-2 block text-[13px] text-ink-soft">{s.description}</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** One server for this project on this machine: its keys stay here, never in the repo. */
function AddServer({
  onAdd,
  onCancel,
}: {
  onAdd: (s: { name: string; target: string; headers: string[]; env: string[] }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const url = /^https?:\/\//i.test(target.trim())

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        const lines = secret.split('\n').map((l) => l.trim()).filter(Boolean)
        await onAdd({ name, target, headers: url ? lines : [], env: url ? [] : lines })
        setBusy(false)
      }}
      className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap gap-2">
        <label className="flex w-40 flex-col gap-1 text-xs font-semibold text-ink-soft">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="sentry" className={input} />
        </label>
        <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-xs font-semibold text-ink-soft">
          URL or command
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="https://mcp.sentry.dev/mcp  or  npx -y @some/mcp"
            spellCheck={false}
            className={input}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
        {url ? 'Headers, one per line (optional)' : 'Environment, one NAME=value per line (optional)'}
        <textarea
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          rows={2}
          spellCheck={false}
          placeholder={url ? 'Authorization: Bearer …' : 'API_KEY=…'}
          className="rounded-[10px] border border-line bg-surface px-3 py-2 font-mono text-[13px] outline-none [-webkit-text-security:disc] focus:border-ink"
        />
      </label>
      <p className="text-xs text-ink-soft">For this project on this machine only, so its keys are never committed.</p>
      <div className="flex gap-2 self-end">
        <button type="button" onClick={onCancel} className="h-8 rounded-lg px-3 text-[13px] font-medium hover:bg-line-soft">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !name.trim() || !target.trim()}
          className="h-8 rounded-lg bg-ink px-3 text-[13px] font-medium text-white hover:bg-ink/85 disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
    </form>
  )
}

/** What the skill should do; Claude writes it as a task you can check. */
function WriteSkill({ onWrite, onCancel }: { onWrite: (what: string) => Promise<void>; onCancel: () => void }) {
  const [what, setWhat] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        await onWrite(what)
        setBusy(false)
      }}
      className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4"
    >
      <label htmlFor="skill-what" className="text-xs font-semibold text-ink-soft">
        What should it do?
      </label>
      <textarea
        id="skill-what"
        value={what}
        onChange={(e) => setWhat(e.target.value)}
        autoFocus
        rows={3}
        placeholder="Deploy this app: run the tests, build it, and push to the production branch"
        className="rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink"
      />
      <div className="flex gap-2 self-end">
        <button type="button" onClick={onCancel} className="h-8 rounded-lg px-3 text-[13px] font-medium hover:bg-line-soft">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !what.trim()}
          className="h-8 rounded-lg bg-ink px-3 text-[13px] font-medium text-white hover:bg-ink/85 disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Ask Claude to write it'}
        </button>
      </div>
    </form>
  )
}
