import { openSettings } from '#/lib/settings'
import { useEffect, useRef, type ReactNode } from 'react'
import type { LogLine, ServiceView } from '#/server/types'
import { clock } from '#/lib/format'
import { AlertIcon, ExternalIcon } from './icons'
import { QrCode } from './QrCode'
import { WebPreview } from './WebPreview'

/** A line's colour on the dark console, by its level. */
export const LEVEL = {
  info: 'text-term-ink',
  ok: 'text-term-ok',
  warn: 'text-term-warn',
  err: 'text-term-err',
}

/** Output of the selected service, under its tab: one toolbar, then its preview or QR code, then its log. */
export function OutputPanel({
  projectId,
  service,
  logs,
  actions,
  tabFirst,
}: {
  projectId: string
  service: ServiceView
  logs: LogLine[]
  /** The service's Start/Stop and ⋯, at the end of the toolbar. */
  actions: ReactNode
  /** The first tab is this one, so the card's top-left corner meets it square. */
  tabFirst: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const last = logs.at(-1)?.seq
  const up = service.status === 'running' || service.status === 'starting'

  useEffect(() => {
    pinned.current = true
  }, [service.id])

  useEffect(() => {
    const el = box.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [last, service.id])

  return (
    <section aria-label={`${service.name} output`} className="flex flex-[1_1_0px] flex-col gap-3">
      {/* A 0px basis fills the window without growing with the output; min-h-min keeps a preview above it whole. */}
      <div className={`flex min-h-min flex-[1_1_0px] flex-col overflow-hidden rounded-2xl border border-line bg-surface ${tabFirst ? 'rounded-tl-none' : ''}`}>
        {service.preview ? (
          <WebPreview
            projectId={projectId}
            id={service.id}
            name={service.name}
            url={service.preview.url}
            embeddable={service.preview.embeddable}
            ready={service.preview.ready ?? true}
            actions={actions}
          />
        ) : (
          // Shaped like the preview's address bar, so every service's toolbar matches.
          <div className="flex items-center gap-1.5 border-b border-line bg-bg/60 px-2 py-1.5">
            <div className="flex h-8 min-w-0 flex-1 items-center gap-2 px-[11px] text-[13px]">
              {service.needsDomain ? (
                <button type="button" onClick={openSettings} className="font-medium text-ink-soft hover:text-ink hover:underline">
                  Add a dev domain to open it
                </button>
              ) : !up ? (
                // Stopped: what Start will run.
                <code className="min-w-0 truncate font-mono text-xs text-ink-soft">$ {service.command}</code>
              ) : service.qr ? (
                // A phone app: its address, to copy; the QR code below opens it.
                <code title={service.qr.url} className="min-w-0 truncate font-mono text-xs select-all">
                  {service.qr.url}
                </code>
              ) : (
                // Not a web page or a phone app: say where it runs.
                service.url && (
                  <>
                    <span className="text-ink-soft">Runs at</span>
                    <code className="min-w-0 truncate font-mono text-xs select-all">
                      {service.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    </code>
                    <a
                      href={service.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${service.name} in a new tab`}
                      title="Open in a new tab"
                      className="flex size-8 flex-none items-center justify-center rounded-lg text-ink-soft hover:bg-line-soft hover:text-ink"
                    >
                      <ExternalIcon size={14} />
                    </a>
                  </>
                )
              )}
            </div>
            {actions}
          </div>
        )}
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
        {service.qr && (
          <div className="flex flex-wrap items-center gap-5 border-b border-line p-4">
            <QrCode value={service.qr.url} label={`QR code to open ${service.name} on your phone`} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-[15px] font-semibold">Open on your phone</p>
              <p className="text-[13px] leading-relaxed text-ink-soft">{service.qr.hint}</p>
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
          className="min-h-[360px] flex-[1_1_0px] overflow-auto bg-term px-4 py-3.5 font-mono text-term-ink [color-scheme:dark] text-[12.5px] leading-[1.75]"
        >
          {logs.length === 0 ? (
            <p className="text-term-faint">Nothing yet. Start {service.name} and its output shows up here.</p>
          ) : (
            logs.map((l) => (
              <div key={l.seq} className={`flex gap-3.5 whitespace-pre-wrap ${LEVEL[l.level]}`}>
                <span className="flex-none text-term-faint">{clock(l.t)}</span>
                <span className="min-w-0 break-words">{l.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}
