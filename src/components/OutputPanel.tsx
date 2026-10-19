import { useEffect, useRef } from 'react'
import type { LogLine, ServiceView } from '#/server/types'
import { clock } from '#/lib/format'
import { AlertIcon } from './icons'
import { QrCode } from './QrCode'
import { WebPreview } from './WebPreview'

const LEVEL = {
  info: 'text-ink',
  ok: 'text-ok',
  warn: 'text-[oklch(52%_0.12_70)]',
  err: 'text-err',
}

/** Output of the selected service. Picking a service happens on its card. */
export function OutputPanel({ service, logs }: { service: ServiceView; logs: LogLine[] }) {
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const last = logs.at(-1)?.seq

  useEffect(() => {
    pinned.current = true
  }, [service.id])

  useEffect(() => {
    const el = box.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [last, service.id])

  return (
    <section aria-labelledby="out-h" className="flex flex-grow flex-col gap-3">
      <h2 id="out-h" className="text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase">
        {service.name} output
      </h2>

      <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
        {service.status === 'error' && (
          <div className="flex items-center gap-2.5 border-b border-line bg-err-tint px-4 py-3 text-[13px]">
            <AlertIcon className="flex-none text-err" />
            <span>
              <strong className="font-semibold">
                {service.name} {service.exitCode !== null ? `crashed (exit ${service.exitCode})` : 'couldn’t start'}.
              </strong>{' '}
              {service.exitCode !== null ? 'It’s in your tasks.' : 'Check its command and folder.'}
            </span>
          </div>
        )}
        {service.preview && (
          <WebPreview
            id={service.id}
            name={service.name}
            url={service.preview.url}
            embeddable={service.preview.embeddable}
            ready={service.preview.ready ?? true}
          />
        )}
        {service.qr && (
          <div className="flex flex-wrap items-center gap-5 border-b border-line p-4">
            <QrCode value={service.qr.url} label={`QR code to open ${service.name} on your phone`} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-[15px] font-semibold">Open on your phone</p>
              <p className="text-[13px] leading-relaxed text-ink-soft">{service.qr.hint}</p>
              <code className="break-all font-mono text-xs select-all">{service.qr.url}</code>
            </div>
          </div>
        )}
        <div
          ref={box}
          role="log"
          aria-label={`${service.name} output`}
          onScroll={(e) => {
            const el = e.currentTarget
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
          className="h-[360px] overflow-auto px-4 py-3.5 font-mono text-[12.5px] leading-[1.75]"
        >
          {logs.length === 0 ? (
            <p className="text-ink-soft">Nothing yet. Start {service.name} and its output shows up here.</p>
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
