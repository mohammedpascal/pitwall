import type { ServiceStatus, ServiceView } from '#/server/types'
import { duration } from '#/lib/format'
import { ExternalIcon, PlayIcon, StopIcon } from './icons'

export const STATUS: Record<
  ServiceStatus,
  { label: string; dot: string; action: 'Start' | 'Stop' | 'Restart' }
> = {
  running: { label: 'Running', dot: 'bg-ok', action: 'Stop' },
  starting: { label: 'Starting…', dot: 'bg-warn', action: 'Stop' },
  stopped: { label: 'Stopped', dot: 'border-[1.5px] border-ink-faint', action: 'Start' },
  error: { label: 'Crashed', dot: 'bg-err', action: 'Restart' },
}

export function ServiceCard({
  service: s,
  selected,
  now,
  busy,
  onSelect,
  onToggle,
}: {
  service: ServiceView
  selected: boolean
  now: number
  busy: boolean
  onSelect: () => void
  onToggle: () => void
}) {
  const look = STATUS[s.status]
  const isStop = look.action === 'Stop'
  const meta =
    s.status === 'running' && s.startedAt ? `up ${duration(now - s.startedAt)}` : null

  return (
    <div
      className={`flex flex-col gap-3.5 rounded-2xl border-[1.5px] bg-surface p-4 ${
        selected ? 'border-ink' : 'border-line'
      }`}
    >
      <div className="flex items-center justify-between gap-2.5">
        <button
          type="button"
          onClick={onSelect}
          aria-label={`Show ${s.name} output`}
          className="flex items-center gap-2.5 text-base font-semibold hover:underline"
        >
          <span aria-hidden="true" className={`size-[9px] flex-none rounded-full ${look.dot}`} />
          {s.name}
        </button>
        <span className="text-xs font-medium text-ink-soft">
          {s.status === 'error' && s.exitCode !== null ? `Crashed · ${s.exitCode}` : look.label}
        </span>
      </div>

      <div className="truncate rounded-lg bg-bg px-2.5 py-2 font-mono text-xs" title={s.command}>
        $ {s.command}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5 text-xs text-ink-soft">
          {s.cwdLabel !== '.' && <span className="truncate font-mono">{s.cwdLabel}</span>}
          {s.url && s.status === 'running' ? (
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 truncate font-mono text-ink hover:underline"
            >
              {s.url.replace(/^https?:\/\//, '')}
              <ExternalIcon />
            </a>
          ) : (
            <span className="font-mono">{meta ?? ' '}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          aria-label={`${look.action} ${s.name}`}
          className={`inline-flex h-11 min-w-24 flex-none items-center justify-center gap-2 rounded-[10px] border px-3.5 font-medium transition-colors disabled:opacity-50 ${
            isStop
              ? 'border-line bg-surface text-ink hover:bg-line-soft'
              : 'border-ink bg-ink text-white hover:bg-ink/85'
          }`}
        >
          {isStop ? <StopIcon /> : <PlayIcon />}
          {look.action}
        </button>
      </div>
    </div>
  )
}
