import { useEffect, useRef, useState } from 'react'
import type { TaskDetail, TaskStart } from '#/server/types'
import { ago, clock } from '#/lib/format'
import { read, write } from '#/lib/storage'
import { KIND, STAGE, askingLabel, isClosed } from '#/lib/stages'
import { AlertIcon, PaperclipIcon, sourceIcon } from './icons'
import { Menu } from './Menu'
import { MODE, ModePicker, useMode } from './ModePicker'
import { ModelPicker, useModel } from './ModelPicker'
import { MODELS, type ModelChoice } from '#/lib/models'
import { PlanFrame } from './PlanFrame'
import { QrCode } from './QrCode'

export type TaskCommand =
  | { type: 'plan'; note?: string }
  | { type: 'do'; note?: string }
  | { type: 'confirm'; ok: boolean; note?: string }
  | { type: 'dismiss' }
  | { type: 'done' }
  | { type: 'reopen' }
  | { type: 'stop' }
  | { type: 'restart' }
  | { type: 'follow'; note: string; how: TaskStart; model: ModelChoice }
  | { type: 'model'; model: ModelChoice }
  | { type: 'remote'; on: boolean }
  | { type: 'answer'; decision: 'allow' | 'always' | 'deny' }

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
  const { task: t, plan, log, parent, followUps, remote, asking } = detail
  // Folded away per task in this browser; a new version unfolds it, since it's new to read.
  const planKey = `pitwall:plan-hidden:${t.id}`
  const [planHidden, setPlanHidden] = useState(false)
  const versions = t.plans?.length ?? 0
  useEffect(() => {
    const seen = Number(read(`${planKey}:v`) ?? 0)
    if (versions > seen) {
      write(`${planKey}:v`, String(versions))
      write(planKey, '0')
    }
    setPlanHidden(read(planKey) === '1')
  }, [planKey, versions])
  function togglePlan(hide = !planHidden) {
    write(planKey, hide ? '1' : '0')
    setPlanHidden(hide)
  }
  const stage = STAGE[t.stage]
  const Icon = sourceIcon[t.source]
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const [followMode, setFollowMode] = useMode('pitwall.followMode', 'do')
  const [remembered, remember] = useModel('pitwall.model')
  // A follow-up starts on the model of the task it follows (if it had one) until you pick another.
  const [picked, setPicked] = useState<{ task: string; model: ModelChoice } | null>(null)
  const followModel = picked?.task === t.id ? picked.model : (t.model ?? remembered)
  const setFollowModel = (m: ModelChoice) => {
    setPicked({ task: t.id, model: m })
    remember(m)
  }
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
  type Action = { label: string; run: () => Promise<void>; needsText?: boolean }
  const planIt: Action = { label: 'Plan', run: () => send({ type: 'plan', note }) }
  const doIt: Action = { label: 'Do it', run: () => send({ type: 'do', note }) }
  // While you drive it remotely, Pitwall's steps wait.
  const step = remote
    ? null
    : t.stage === 'ready'
      ? {
          placeholder: 'Anything to add (optional)…',
          // A simple task needs no plan; either way, the other is a click away.
          primary: t.simple ? doIt : planIt,
          secondary: t.simple ? planIt : doIt,
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
                picker: (
                  <>
                    <ModelPicker model={followModel} onPick={setFollowModel} />
                    <ModePicker mode={followMode} onPick={setFollowMode} />
                  </>
                ),
                primary: {
                  label: MODE[followMode].button,
                  run: () => send({ type: 'follow', note, how: followMode, model: followModel }),
                  needsText: true,
                },
              }
            : null

  const menu = [
    ...(stage.working ? [{ label: 'Stop Claude', onSelect: () => void send({ type: 'stop' }) }] : []),
    ...(remote
      ? [{ label: 'Stop remote control', onSelect: () => void send({ type: 'remote', on: false }) }]
      : t.sessionId && !stage.working
        ? [{ label: 'Remote control', onSelect: () => void send({ type: 'remote', on: true }) }]
        : []),
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
                <span className="rounded-full border border-line px-1.5 py-px text-[11px] font-semibold text-ink">
                  {KIND[t.kind]}
                </span>
              )}
              <Icon />
              {t.sourceLabel} · {ago(t.lastSeenAt ?? t.createdAt, now)} ·{' '}
              {/* Which Claude does its next steps; change it here. */}
              {isClosed(t) ? (
                MODELS[t.model ?? 'default'].label
              ) : (
                <ModelPicker
                  compact
                  model={t.model ?? 'default'}
                  onPick={(m) => void send({ type: 'model', model: m })}
                />
              )}
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

        {asking && (
          <div className="flex flex-col gap-3 border-b border-line bg-warn/10 px-5 py-4 text-[13px]">
            <span className="inline-flex items-center gap-2 font-semibold">
              <span aria-hidden="true" className="size-2 rounded-full bg-warn" />
              {askingLabel(asking.tool).replace('asks to', 'wants to')}
            </span>
            <code className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[12.5px] break-all whitespace-pre-wrap">
              {asking.summary}
            </code>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={sending}
                onClick={() => void send({ type: 'answer', decision: 'allow' })}
                className="h-9 rounded-lg bg-ink px-4 font-medium text-white hover:bg-ink/85 disabled:opacity-50"
              >
                Allow
              </button>
              <button
                type="button"
                disabled={sending}
                onClick={() => void send({ type: 'answer', decision: 'always' })}
                className="h-9 rounded-lg border border-line bg-surface px-3 font-medium hover:bg-line-soft disabled:opacity-50"
              >
                Always allow in this project
              </button>
              <button
                type="button"
                disabled={sending}
                onClick={() => void send({ type: 'answer', decision: 'deny' })}
                className="h-9 rounded-lg px-3 font-medium text-ink-soft hover:bg-line-soft hover:text-ink disabled:opacity-50"
              >
                Deny
              </button>
            </div>
          </div>
        )}

        {remote && (
          <div className="flex items-center gap-4 border-b border-line px-5 py-3 text-[13px]">
            {remote.url && <QrCode value={remote.url} size={88} label="Scan to continue on your phone" />}
            <div className="flex min-w-0 flex-grow flex-col gap-1">
              <span className="inline-flex items-center gap-2 font-medium">
                <span aria-hidden="true" className={`size-2 rounded-full bg-ok ${remote.url ? '' : 'animate-pulse'}`} />
                {remote.url ? 'Remote control' : 'Connecting…'}
              </span>
              {remote.url && (
                <a
                  href={remote.url}
                  target="_blank"
                  rel="noreferrer"
                  className="self-start text-ink-soft hover:text-ink hover:underline"
                >
                  Open in Claude ↗
                </a>
              )}
            </div>
            <button
              type="button"
              onClick={() => void send({ type: 'remote', on: false })}
              className="h-9 flex-none rounded-lg border border-line px-3 font-medium hover:bg-line-soft"
            >
              Stop
            </button>
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
            {/* The strip folds the plan away and back, like a preview's Hide. */}
            <div
              role="button"
              tabIndex={0}
              aria-expanded={!planHidden}
              onClick={() => togglePlan()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  togglePlan()
                }
              }}
              className={`flex cursor-pointer items-center justify-between gap-2 bg-bg/60 px-4 py-2 text-xs hover:bg-line-soft/60 ${
                planHidden ? '' : 'border-b border-line-soft'
              }`}
            >
              <span className="font-semibold">
                Plan v{plan.v}
                {plans.find((p) => p.v === plan.v)?.note && (
                  <span className="ml-2 font-normal text-ink-soft">“{plans.find((p) => p.v === plan.v)?.note}”</span>
                )}
              </span>
              <span className="flex items-center gap-1">
                {plans.length > 1 && (
                  <span className="flex items-center gap-1" role="group" aria-label="Plan versions">
                    {plans.map((p) => (
                      <button
                        key={p.v}
                        type="button"
                        aria-pressed={p.v === showing}
                        onClick={(e) => {
                          // Picks a version, and shows it if the plan was folded away.
                          e.stopPropagation()
                          onVersion(p.v === latest ? null : p.v)
                          togglePlan(false)
                        }}
                        className={`h-7 min-w-7 rounded-md px-1.5 font-medium ${
                          p.v === showing ? 'bg-ink text-white' : 'text-ink-soft hover:bg-line-soft hover:text-ink'
                        }`}
                      >
                        v{p.v}
                      </button>
                    ))}
                  </span>
                )}
                <span className="ml-2 font-medium text-ink-soft">{planHidden ? 'Show plan' : 'Hide'}</span>
              </span>
            </div>
            {!planHidden && <PlanFrame title={`Plan v${plan.v}`} html={plan.html} />}
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
              {'picker' in step && step.picker}
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
