import { useEffect, useRef, useState } from 'react'
import type { TaskDetail } from '#/server/types'
import { ago, clock } from '#/lib/format'
import { KIND, STAGE, isClosed } from '#/lib/stages'
import { AlertIcon, PaperclipIcon, sourceIcon } from './icons'
import { Menu } from './Menu'

export type TaskCommand =
  | { type: 'plan'; note?: string }
  | { type: 'do' }
  | { type: 'confirm'; ok: boolean; note?: string }
  | { type: 'dismiss' }
  | { type: 'done' }
  | { type: 'reopen' }
  | { type: 'stop' }
  | { type: 'restart' }
  | { type: 'follow'; note: string }

/** One task, opened in the main panel: what it is, its plan, and the next decision. */
export function TaskView({
  detail,
  now,
  version,
  onVersion,
  onCommand,
  onClose,
  onOpenTask,
}: {
  detail: TaskDetail
  now: number
  /** Plan version being shown; null means the latest. */
  version: number | null
  onVersion: (v: number | null) => void
  onCommand: (c: TaskCommand) => Promise<void>
  onClose: () => void
  onOpenTask: (id: string) => void
}) {
  const { task: t, plan, log, parent, followUps } = detail
  const stage = STAGE[t.stage]
  const Icon = sourceIcon[t.source]
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const plans = t.plans ?? []
  const latest = plans.at(-1)?.v ?? null
  const showing = version ?? latest

  // A new task, or a step finished: start with an empty box.
  useEffect(() => setDraft(''), [t.id, t.stage])

  async function send(c: TaskCommand) {
    setSending(true)
    try {
      await onCommand(c)
      setDraft('')
    } finally {
      setSending(false)
    }
  }

  const note = draft.trim()
  // The text box and buttons change with the stage; there's always one primary action.
  const step =
    t.stage === 'ready'
      ? {
          placeholder: 'Steer the plan (optional)…',
          primary: { label: 'Plan', run: () => send({ type: 'plan', note }) },
        }
      : t.stage === 'planned'
        ? {
            placeholder: 'What should change in the plan?',
            secondary: { label: 'Revise', run: () => send({ type: 'plan', note }), needsText: true },
            primary: { label: 'Do it', run: () => send({ type: 'do' }) },
            // Typing turns Enter into Revise; an empty box goes ahead.
            enter: note ? 'secondary' : 'primary',
          }
        : t.stage === 'check'
          ? {
              placeholder: 'What isn’t right?',
              secondary: { label: 'Not right', run: () => send({ type: 'confirm', ok: false, note }), needsText: true },
              primary: { label: 'Looks good', run: () => send({ type: 'confirm', ok: true }) },
              enter: note ? 'secondary' : 'primary',
            }
          : isClosed(t)
            ? {
                // A new task that picks up this one's conversation.
                placeholder: 'Follow up on this…',
                primary: { label: 'Follow up', run: () => send({ type: 'follow', note }), needsText: true },
              }
            : null

  const menu = [
    ...(stage.working ? [{ label: 'Stop Claude', onSelect: () => void send({ type: 'stop' }) }] : []),
    ...(!isClosed(t) ? [{ label: 'Mark done', onSelect: () => void send({ type: 'done' }) }] : []),
    ...(!stage.working ? [{ label: 'Start over', onSelect: () => void send({ type: 'restart' }) }] : []),
    ...(!isClosed(t) ? [{ label: 'Dismiss', onSelect: () => void send({ type: 'dismiss' }), danger: true }] : []),
  ]

  return (
    <section aria-labelledby="task-h" className="flex flex-grow flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onClose}
          className="-ml-2 inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase hover:bg-line-soft hover:text-ink"
        >
          <span aria-hidden="true">←</span> Output
        </button>
      </div>

      <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
        <header className="flex flex-col gap-3 border-b border-line p-5">
          <div className="flex items-center justify-between gap-2 text-xs text-ink-soft">
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
              {t.kind && (
                <span className="rounded-full border border-line px-1.5 py-px text-[11px] font-semibold text-ink">{KIND[t.kind]}</span>
              )}
              <Icon />
              {t.sourceLabel} · {ago(t.lastSeenAt ?? t.createdAt, now)}
              {(t.count ?? 1) > 1 && ` · ×${t.count}`}
            </span>
            {menu.length > 0 && <Menu label="Task options" size="sm" items={menu} />}
          </div>
          {parent && (
            <button
              type="button"
              onClick={() => onOpenTask(parent.id)}
              className="-mb-1 self-start truncate text-left text-xs text-ink-soft hover:text-ink hover:underline"
            >
              Follow-up to {parent.title}
            </button>
          )}
          <h2 id="task-h" className="text-xl leading-snug font-semibold tracking-[-0.01em] break-words">
            {t.title}
          </h2>
          {t.summary && <p className="max-w-[68ch] text-[13.5px] leading-relaxed text-ink-soft">{t.summary}</p>}
          {followUps.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-ink-soft">Follow-ups</span>
              <ul className="flex flex-col gap-0.5">
                {followUps.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => onOpenTask(f.id)}
                      className="flex max-w-full items-baseline gap-2 text-left text-[13px] hover:underline"
                    >
                      <span className="truncate">{f.title}</span>
                      <span className="flex-none text-xs text-ink-soft">{STAGE[f.stage].label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {t.attachments && t.attachments.length > 0 && (
            <ul aria-label="Attachments" className="flex flex-wrap gap-2">
              {t.attachments.map((a) => {
                const href = `/attachments/${t.id}/${encodeURIComponent(a.file)}`
                const image = /^image\/(png|jpe?g|gif|webp|avif)$/.test(a.type)
                return (
                  <li key={a.file}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      title={`Open ${a.name}`}
                      className="flex items-center gap-2 rounded-lg border border-line bg-bg p-1 pr-2.5 hover:border-ink"
                    >
                      {image ? (
                        <img src={href} alt="" className="size-14 rounded object-cover" />
                      ) : (
                        <span className="flex size-9 items-center justify-center rounded bg-line-soft text-ink-soft">
                          <PaperclipIcon size={14} />
                        </span>
                      )}
                      <span className="max-w-[180px] truncate text-xs font-medium">{a.name}</span>
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
          {(t.original && t.original !== t.title) || t.detail ? (
            <div className="flex flex-wrap gap-4 text-xs">
              {t.original && t.original !== t.title && (
                <details>
                  <summary className="text-ink-soft">As it arrived</summary>
                  <p className="mt-2 max-w-[68ch] text-[13px] leading-relaxed whitespace-pre-wrap">{t.original}</p>
                </details>
              )}
              {t.detail && (
                <details>
                  <summary className="text-ink-soft">Output</summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-bg p-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">
                    {t.detail}
                  </pre>
                </details>
              )}
            </div>
          ) : null}
        </header>

        {t.error && (
          <div className="flex items-center gap-2.5 border-b border-line bg-err-tint px-5 py-3 text-[13px]">
            <AlertIcon className="flex-none text-err" />
            <span>{t.error}</span>
          </div>
        )}

        {isClosed(t) && (
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 text-[13px]">
            <span className="text-ink-soft">{t.closedReason ?? stage.label}</span>
            <button
              type="button"
              onClick={() => void send({ type: 'reopen' })}
              className="h-9 rounded-lg border border-line px-3 font-medium hover:bg-line-soft"
            >
              Reopen
            </button>
          </div>
        )}

        {plan && (
          <div className="flex flex-col border-b border-line">
            <div className="flex items-center justify-between gap-2 border-b border-line-soft bg-bg/60 px-4 py-2 text-xs">
              <span className="font-semibold">
                Plan v{plan.v}
                {plans.find((p) => p.v === plan.v)?.note && (
                  <span className="ml-2 font-normal text-ink-soft">“{plans.find((p) => p.v === plan.v)?.note}”</span>
                )}
              </span>
              {plans.length > 1 && (
                <span className="flex items-center gap-1" role="group" aria-label="Plan versions">
                  {plans.map((p) => (
                    <button
                      key={p.v}
                      type="button"
                      aria-pressed={p.v === showing}
                      onClick={() => onVersion(p.v === latest ? null : p.v)}
                      className={`h-7 min-w-7 rounded-md px-1.5 font-medium ${
                        p.v === showing ? 'bg-ink text-white' : 'text-ink-soft hover:bg-line-soft hover:text-ink'
                      }`}
                    >
                      v{p.v}
                    </button>
                  ))}
                </span>
              )}
            </div>
            <div className="h-[640px] min-h-[240px] resize-y overflow-hidden bg-white">
              {/* Claude's page, fully sandboxed: no scripts, no access to Pitwall. */}
              <iframe title={`Plan v${plan.v}`} srcDoc={plan.html} sandbox="" className="block h-full w-full border-0" />
            </div>
          </div>
        )}

        {t.changedFiles && t.changedFiles.length > 0 && (
          <div className="flex flex-col gap-1.5 border-b border-line px-5 py-3">
            <span className="text-xs font-semibold text-ink-soft">Changed</span>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
              {t.changedFiles.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        {step && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const which = 'enter' in step && step.enter === 'secondary' ? step.secondary : step.primary
              if (which && !(which.needsText && !note)) void which.run()
            }}
            className="flex flex-col gap-2 border-b border-line p-4"
          >
            <label htmlFor="task-note" className="sr-only">
              {step.placeholder}
            </label>
            <textarea
              id="task-note"
              ref={box}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  e.currentTarget.form?.requestSubmit()
                }
              }}
              placeholder={step.placeholder}
              className="resize-y rounded-[10px] border border-line bg-surface px-3 py-2.5 text-sm leading-normal outline-none placeholder:text-ink-faint focus:border-ink"
            />
            <div className="flex items-center justify-end gap-1.5">
              {step.secondary && (
                <button
                  type="button"
                  disabled={sending || (step.secondary.needsText && !note)}
                  onClick={() => void step.secondary?.run()}
                  className="h-9 rounded-lg border border-line px-3.5 text-[13px] font-medium hover:bg-line-soft disabled:opacity-40"
                >
                  {step.secondary.label}
                </button>
              )}
              <button
                type="button"
                disabled={sending || (step.primary.needsText && !note)}
                onClick={() => void step.primary.run()}
                className="h-9 rounded-lg bg-ink px-4 text-[13px] font-medium text-white hover:bg-ink/85 disabled:opacity-40"
              >
                {step.primary.label}
              </button>
            </div>
          </form>
        )}

        {stage.working && (
          <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-[13px] text-ink-soft">
            <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-ink" />
            {stage.label}
          </div>
        )}

        <ClaudeLog log={log} open={!!stage.working} />
      </div>
    </section>
  )
}

const LEVEL = { info: 'text-ink', ok: 'text-ok', warn: 'text-ink-soft', err: 'text-err' }

function ClaudeLog({ log, open }: { log: TaskDetail['log']; open: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const last = log.at(-1)?.seq
  useEffect(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [last, open])
  if (log.length === 0) return null
  return (
    <details open={open || undefined} className="group">
      <summary className="px-5 py-3 text-xs font-semibold text-ink-soft">Claude’s output</summary>
      <div
        ref={box}
        role="log"
        aria-label="Claude’s output"
        className="max-h-[320px] overflow-auto px-5 pb-4 font-mono text-[12px] leading-[1.75]"
      >
        {log.map((l) => (
          <div key={l.seq} className={`flex gap-3.5 whitespace-pre-wrap ${LEVEL[l.level]}`}>
            <span className="flex-none text-ink-faint">{clock(l.t)}</span>
            <span className="min-w-0 break-words">{l.text}</span>
          </div>
        ))}
      </div>
    </details>
  )
}
