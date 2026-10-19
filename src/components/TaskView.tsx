import { useEffect, useRef, useState } from 'react'
import type { AttachmentUpload, TaskDetail, TaskStart } from '#/server/types'
import { AttachButton, AttachmentChips, useAttachments } from './Attachments'
import { ago, clock } from '#/lib/format'
import { read, write } from '#/lib/storage'
import { KIND, STAGE, askingLabel, isClosed } from '#/lib/stages'
import { AlertIcon, ArrowUpIcon, PaperclipIcon, sourceIcon } from './icons'
import { Menu } from './Menu'
import { MODE, ModePicker, useMode } from './ModePicker'
import { ModelPicker, useModel } from './ModelPicker'
import { MODELS, type ModelChoice } from '#/lib/models'
import { PlanFrame } from './PlanFrame'
import { SkillSuggest, useSkillSuggest } from './SkillSuggest'
import type { Skill } from '#/server/tools'
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
  | { type: 'follow'; note: string; how: TaskStart; model: ModelChoice; attachments?: AttachmentUpload[] }
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
  skills = [],
}: {
  detail: TaskDetail
  now: number
  /** Plan version being shown; null means the latest. */
  version: number | null
  onVersion: (v: number | null) => void
  onCommand: (c: TaskCommand) => Promise<void>
  onClose: () => void
  onOpenTask: (id: string) => void
  /** Offered in the follow-up box when it starts with "/". */
  skills?: Skill[]
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
  const [arrivedHidden, foldArrived] = useFolded(`pitwall:fold:arrived:${t.id}`, true)
  const [detailHidden, foldDetail] = useFolded(`pitwall:fold:detail:${t.id}`, true)
  const [changedHidden, foldChanged] = useFolded(`pitwall:fold:changed:${t.id}`, false)
  const [followUpsHidden, foldFollowUps] = useFolded(`pitwall:fold:follow-ups:${t.id}`, false)
  const stage = STAGE[t.stage]
  const Icon = sourceIcon[t.source]
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const [followMode, setFollowMode] = useMode('pitwall.followMode', 'do')
  const [remembered, remember] = useModel('pitwall.model')
  // A follow-up starts on the model of the task it follows (if it had one) until you pick another.
  const [picked, setPicked] = useState<{
    task: string
    model: ModelChoice
  } | null>(null)
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
  // A follow-up can carry files, like a new task.
  const attach = useAttachments()
  const [dragging, setDragging] = useState(false)
  useEffect(() => attach.clear(), [t.id, t.stage]) // eslint-disable-line react-hooks/exhaustive-deps

  async function send(c: TaskCommand) {
    setSending(true)
    try {
      await onCommand(c)
      setDraft('')
      attach.clear()
    } finally {
      setSending(false)
    }
  }

  const note = draft.trim()
  const suggest = useSkillSuggest(draft, isClosed(t) ? skills : [], setDraft)
  // The text box and buttons change with the stage; there's always one primary action.
  type Action = {
    label: string
    run: () => Promise<void>
    needsText?: boolean
  }
  const planIt: Action = {
    label: 'Plan',
    run: () => send({ type: 'plan', note }),
  }
  const doIt: Action = {
    label: 'Do it',
    run: () => send({ type: 'do', note }),
  }
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
            secondary: {
              label: 'Revise',
              run: () => send({ type: 'plan', note }),
              needsText: true,
            },
            primary: { label: 'Do it', run: () => send({ type: 'do' }) },
            // Typing turns Enter into Revise; an empty box goes ahead.
            enter: note ? 'secondary' : 'primary',
          }
        : t.stage === 'check'
          ? {
              placeholder: 'What isn’t right?',
              secondary: {
                label: 'Not right',
                run: () => send({ type: 'confirm', ok: false, note }),
                needsText: true,
              },
              primary: {
                label: 'Looks good',
                run: () => send({ type: 'confirm', ok: true }),
              },
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
                attachable: true,
                primary: {
                  label: MODE[followMode].button,
                  run: async () => {
                    let attachments
                    try {
                      attachments = await attach.uploads()
                    } catch (e) {
                      attach.setProblem(e instanceof Error ? e.message : String(e))
                      return
                    }
                    await send({ type: 'follow', note, how: followMode, model: followModel, attachments })
                  },
                  // Files alone are enough, as with a new task.
                  needsText: attach.files.length === 0,
                },
              }
            : null

  const menu = [
    ...(stage.working ? [{ label: 'Stop Claude', onSelect: () => void send({ type: 'stop' }) }] : []),
    ...(remote
      ? [
          {
            label: 'Stop remote control',
            onSelect: () => void send({ type: 'remote', on: false }),
          },
        ]
      : t.sessionId && !stage.working
        ? [
            {
              label: 'Remote control',
              onSelect: () => void send({ type: 'remote', on: true }),
            },
          ]
        : []),
    ...(!isClosed(t) ? [{ label: 'Mark done', onSelect: () => void send({ type: 'done' }) }] : []),
    ...(!stage.working
      ? [
          {
            label: 'Start over',
            onSelect: () => void send({ type: 'restart' }),
          },
        ]
      : []),
    ...(!isClosed(t)
      ? [
          {
            label: 'Dismiss',
            onSelect: () => void send({ type: 'dismiss' }),
            danger: true,
          },
        ]
      : []),
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

        {t.original && t.original !== t.title && (
          <Section label="As it arrived" hidden={arrivedHidden} onToggle={foldArrived}>
            <p className="max-w-[68ch] px-5 py-3 text-[13px] leading-relaxed whitespace-pre-wrap">{t.original}</p>
          </Section>
        )}

        {t.detail && (
          <Section label="Output" hidden={detailHidden} onToggle={foldDetail}>
            <pre className="max-h-48 overflow-auto px-5 py-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">
              {t.detail}
            </pre>
          </Section>
        )}

        {plan && (
          <Section
            label={
              <>
                Plan v{plan.v}
                {plans.find((p) => p.v === plan.v)?.note && (
                  <span className="ml-2 font-normal text-ink-soft">“{plans.find((p) => p.v === plan.v)?.note}”</span>
                )}
              </>
            }
            extra={
              plans.length > 1 && (
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
              )
            }
            hidden={planHidden}
            onToggle={togglePlan}
          >
            <PlanFrame title={`Plan v${plan.v}`} html={plan.html} />
          </Section>
        )}

        {t.changedFiles && t.changedFiles.length > 0 && (
          <Section
            label={
              <>
                Changed
                <span className="font-normal text-ink-soft">
                  {' '}
                  · {t.changedFiles.length} {t.changedFiles.length === 1 ? 'file' : 'files'}
                </span>
              </>
            }
            hidden={changedHidden}
            onToggle={foldChanged}
          >
            <ul className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-3 font-mono text-xs">
              {t.changedFiles.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </Section>
        )}

        {followUps.length > 0 && (
          <Section
            label={
              <>
                Follow-ups <span className="font-normal text-ink-soft">· {followUps.length}</span>
              </>
            }
            hidden={followUpsHidden}
            onToggle={foldFollowUps}
          >
            {/* Each follow-up reads as a message, in order; it opens its own task. */}
            <ul className="flex flex-col">
              {followUps.map((f) => (
                <li key={f.id} className="border-b border-line-soft last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onOpenTask(f.id)}
                    className="flex w-full flex-col gap-0.5 px-5 py-3 text-left hover:bg-line-soft/40"
                  >
                    <span className="flex items-baseline justify-between gap-2 text-xs text-ink-soft">
                      <span className="truncate">
                        {f.sourceLabel} · {ago(f.createdAt, now)}
                      </span>
                      <span className="flex-none">{STAGE[f.stage].label}</span>
                    </span>
                    <span className="max-w-[68ch] text-[13.5px] leading-relaxed break-words whitespace-pre-wrap">
                      {f.original ?? f.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {step && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const which = 'enter' in step && step.enter === 'secondary' ? step.secondary : step.primary
              if (which && !(which.needsText && !note)) void which.run()
            }}
            className="border-b border-line p-4"
          >
            {/* One box with the buttons inside, like the new-task composer. */}
            <div
              onDragOver={(e) => {
                if (!('attachable' in step) || ![...e.dataTransfer.types].includes('Files')) return
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
              }}
              onDrop={(e) => {
                if (!('attachable' in step) || !e.dataTransfer.files.length) return
                e.preventDefault()
                setDragging(false)
                attach.addFiles(e.dataTransfer.files)
              }}
              className={`flex flex-col gap-2 rounded-[14px] border bg-surface p-3 ${
                dragging ? 'border-dashed border-ink bg-line-soft' : 'border-line focus-within:border-ink'
              }`}
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
                onPaste={(e) => {
                  // A pasted screenshot becomes an attachment; pasted text stays text.
                  if ('attachable' in step && e.clipboardData.files.length) {
                    e.preventDefault()
                    attach.addFiles(e.clipboardData.files)
                  }
                }}
                onKeyDown={(e) => {
                  // A follow-up can start with "/" to run a skill.
                  if (suggest.onKeyDown(e)) return
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    e.currentTarget.form?.requestSubmit()
                  }
                }}
                placeholder={dragging ? 'Drop to attach' : step.placeholder}
                className="resize-y bg-transparent text-sm leading-normal outline-none placeholder:text-ink-faint"
              />
              <SkillSuggest {...suggest} />
              <AttachmentChips files={attach.files} onRemove={attach.removeFile} />
              {attach.problem && (
                <p role="alert" className="text-xs text-err">
                  {attach.problem}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {'attachable' in step && (
                  <span className="mr-auto">
                    <AttachButton onPick={attach.addFiles} />
                  </span>
                )}
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
                {step.secondary ? (
                  <button
                    type="button"
                    disabled={sending || (step.primary.needsText && !note)}
                    onClick={() => void step.primary.run()}
                    className="h-9 rounded-lg bg-ink px-4 text-[13px] font-medium text-white hover:bg-ink/85 disabled:opacity-40"
                  >
                    {step.primary.label}
                  </button>
                ) : (
                  // A lone action sends, like the composer's round button.
                  <button
                    type="button"
                    disabled={sending || (step.primary.needsText && !note)}
                    onClick={() => void step.primary.run()}
                    aria-label={step.primary.label}
                    title={step.primary.label}
                    className="flex size-9 items-center justify-center rounded-full bg-ink text-white hover:bg-ink/85 disabled:opacity-40"
                  >
                    <ArrowUpIcon className={sending ? 'animate-pulse' : undefined} />
                  </button>
                )}
              </div>
            </div>
          </form>
        )}

        {stage.working && (
          <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-[13px] text-ink-soft">
            <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-ink" />
            {stage.label}
          </div>
        )}

        <ClaudeLog key={t.id} log={log} open={!!stage.working} />
      </div>
    </section>
  )
}

/** Folded or not, per task and section, remembered in this browser. */
function useFolded(key: string, initial: boolean) {
  const [hidden, setHidden] = useState(initial)
  useEffect(() => {
    const v = read(key)
    setHidden(v === null ? initial : v === '1')
  }, [key, initial])
  function toggle(hide = !hidden) {
    write(key, hide ? '1' : '0')
    setHidden(hide)
  }
  return [hidden, toggle] as const
}

/** One part of the task: a strip that folds it away and back, then the same divider as the rest. */
function Section({
  label,
  extra,
  hidden,
  onToggle,
  children,
}: {
  label: React.ReactNode
  /** Controls beside Show/Hide; their clicks shouldn't fold the section. */
  extra?: React.ReactNode
  hidden: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col border-b border-line last:border-b-0">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!hidden}
        onClick={() => onToggle()}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
        className={`flex cursor-pointer items-center justify-between gap-2 bg-bg/60 px-4 py-2 text-xs hover:bg-line-soft/60 ${
          hidden ? '' : 'border-b border-line-soft'
        }`}
      >
        <span className="font-semibold">{label}</span>
        <span className="flex items-center gap-1">
          {extra}
          <span className="ml-2 font-medium text-ink-soft">{hidden ? 'Show' : 'Hide'}</span>
        </span>
      </div>
      {!hidden && children}
    </div>
  )
}

const LEVEL = {
  info: 'text-ink',
  ok: 'text-ok',
  warn: 'text-ink-soft',
  err: 'text-err',
}

function ClaudeLog({ log, open }: { log: TaskDetail['log']; open: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const last = log.at(-1)?.seq
  // Shown while Claude works; otherwise folded until you ask for it.
  const [hidden, setHidden] = useState(!open)
  useEffect(() => {
    if (open) setHidden(false)
  }, [open])
  useEffect(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [last, hidden])
  if (log.length === 0) return null
  return (
    <Section label="Claude’s output" hidden={hidden} onToggle={() => setHidden((h) => !h)}>
      <div
        ref={box}
        role="log"
        aria-label="Claude’s output"
        className="max-h-[320px] overflow-auto px-5 py-3 font-mono text-[12px] leading-[1.75]"
      >
        {log.map((l) => (
          <div key={l.seq} className={`flex gap-3.5 whitespace-pre-wrap ${LEVEL[l.level]}`}>
            <span className="flex-none text-ink-faint">{clock(l.t)}</span>
            <span className="min-w-0 break-words">{l.text}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}
