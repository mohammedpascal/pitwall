import { useEffect, useRef } from 'react'
import type { LogLine, ServiceView } from '#/server/types'
import { clock } from '#/lib/format'
import { AlertIcon } from './icons'

const LEVEL = {
  info: 'text-ink',
  ok: 'text-ok',
  warn: 'text-[oklch(52%_0.12_70)]',
  err: 'text-err',
}

export function OutputPanel({
  services,
  current,
  logs,
  sent,
  onSelect,
  onRestart,
  onSend,
}: {
  services: ServiceView[]
  current: ServiceView | undefined
  logs: LogLine[]
  sent: boolean
  onSelect: (id: string) => void
  onRestart: () => void
  onSend: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const last = logs.at(-1)?.seq

  useEffect(() => {
    const el = box.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [last, current?.id])

  return (
    <section aria-labelledby="out-h" className="flex flex-grow flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 id="out-h" className="text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase">
          Output
        </h2>
        <div role="tablist" aria-label="Service output" className="flex gap-1 rounded-[10px] bg-line-soft p-[3px]">
          {services.map((s) => {
            const on = s.id === current?.id
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => onSelect(s.id)}
                className={`h-8 rounded-lg px-3 text-[13px] font-medium ${
                  on ? 'bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-ink-soft'
                }`}
              >
                {s.name}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
        {current?.status === 'error' && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-err-tint px-4 py-3">
            <div className="flex items-center gap-2.5 text-[13px]">
              <AlertIcon className="text-err" />
              <strong className="font-semibold">
                {current.name}{' '}
                {current.exitCode !== null ? `exited with code ${current.exitCode}` : 'could not start'}
              </strong>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onRestart}
                className="h-9 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium hover:bg-line-soft"
              >
                Restart
              </button>
              <button
                type="button"
                onClick={onSend}
                disabled={sent}
                className="h-9 rounded-lg bg-ink px-3 text-[13px] font-medium text-white hover:bg-ink/85 disabled:opacity-60"
              >
                {sent ? 'Sent to tasks' : 'Send to tasks'}
              </button>
            </div>
          </div>
        )}
        <div
          ref={box}
          role="log"
          aria-label={`${current?.name ?? 'Service'} output`}
          onScroll={(e) => {
            const el = e.currentTarget
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
          className="h-[360px] overflow-auto px-4 py-3.5 font-mono text-[12.5px] leading-[1.75]"
        >
          {logs.length === 0 ? (
            <p className="text-ink-soft">No output yet. Start {current?.name ?? 'a service'} to see its logs here.</p>
          ) : (
            logs.map((l) => (
              <div key={l.seq} className={`flex gap-3.5 whitespace-pre-wrap ${LEVEL[l.level]}`}>
                <span className="flex-none text-ink-faint">{clock(l.t)}</span>
                <span className="min-w-0 break-words">{l.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}
