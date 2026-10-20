import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AttachmentUpload, LogLine, TaskDetail, TaskStart } from '#/server/types'
import { AttachButton, AttachmentChips, useAttachments } from './Attachments'
import { ago, clock } from '#/lib/format'
import { read, write } from '#/lib/storage'
import { STAGE, askingLabel, isClosed } from '#/lib/stages'
import { AlertIcon, ArrowUpIcon, PaperclipIcon, sourceIcon } from './icons'
import { Menu } from './Menu'
import { MODE, ModePicker, useMode } from './ModePicker'
import { ModelPicker } from './ModelPicker'
import type { ModelChoice } from '#/lib/models'
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
  // Once the task is closed, what changed matters more, so the plan starts folded.
  const planKey = `pitwall:plan-hidden:${t.id}`
  const [planHidden, setPlanHidden] = useState(false)
  const versions = t.plans?.length ?? 0
  const closed = isClosed(t)
  useEffect(() => {
    const seen = Number(read(`${planKey}:v`) ?? 0)
    if (versions > seen) {
      write(`${planKey}:v`, String(versions))
      write(planKey, '0')
    }
    setPlanHidden(closed || read(planKey) === '1')
  }, [planKey, versions, closed])
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
  // A follow-up runs on the task's model, picked in the header.
  const followModel: ModelChoice = t.model ?? 'default'
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
                picker: <ModePicker mode={followMode} onPick={setFollowMode} />,
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
    ...(!isClosed(t)
      ? [{ label: 'Mark done', onSelect: () => void send({ type: 'done' }) }]
      : [{ label: 'Reopen', onSelect: () => void send({ type: 'reopen' }) }]),
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

  // The task's story, oldest first: what you asked, each plan, what changed, how it ended, each follow-up.
  const [outputShown, setOutputShown] = useState<Record<string, boolean>>({})
  useEffect(() => setOutputShown({}), [t.id])
  const working = !!stage.working
  const changedAt = t.changedFiles?.length ? (t.fixedAt ?? (plans.at(-1)?.at ?? t.createdAt) + 1) : null
  const steps = [
    ...plans.map((p) => ({ key: `plan-${p.v}`, at: p.at })),
    ...(changedAt ? [{ key: 'changed', at: changedAt }] : []),
  ].sort((a, b) => a.at - b.at)
  // Each line of output belongs to the step it led to; what comes after the last step is the work going on now.
  const outputOf: Record<string, LogLine[]> = {}
  for (const l of log) {
    const key = steps.find((st) => st.at >= l.t)?.key ?? (working ? 'working' : (steps.at(-1)?.key ?? 'asked'))
    ;(outputOf[key] ??= []).push(l)
  }
  const hasOutput = (key: string) => !!outputOf[key]?.length || (key === 'asked' && !!t.detail)
  const outputButton = (key: string) =>
    hasOutput(key) && (
      <button
        type="button"
        aria-expanded={!!outputShown[key]}
        onClick={() => setOutputShown((o) => ({ ...o, [key]: !o[key] }))}
        className="h-8 rounded-lg px-2.5 text-[12.5px] font-medium text-ink-soft hover:bg-line-soft hover:text-ink"
      >
        {outputShown[key] ? 'Hide output' : 'Output'}
      </button>
    )
  const output = (key: string) =>
    outputShown[key] && (
      <>
        {key === 'asked' && t.detail && (
          <pre className="max-h-48 overflow-auto rounded-[10px] border border-line-soft bg-bg/60 px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">
            {t.detail}
          </pre>
        )}
        {outputOf[key]?.length ? <LogBox lines={outputOf[key]} /> : null}
      </>
    )
  const lastStep = steps.at(-1)?.at ?? t.createdAt

  const events: { key: string; at: number; node: ReactNode }[] = [
    {
      key: 'asked',
      at: t.createdAt,
      node: (
        <Event
          dot="you"
          title={<span className="font-semibold">Asked</span>}
          time={ago(t.createdAt, now)}
          actions={outputButton('asked')}
        >
          {/* What you typed, when it differs from the title above. */}
          {t.original && t.original !== t.title && (
            <p className="max-w-[68ch] text-[13.5px] leading-relaxed break-words whitespace-pre-wrap">{t.original}</p>
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
          {output('asked')}
        </Event>
      ),
    },
    ...plans.flatMap((p) => {
      const open = !planHidden && p.v === showing && plan?.v === p.v
      const waiting = t.stage === 'planned' && p.v === latest
      return [
        ...(p.v > 1 && p.note
          ? [
              {
                key: `ask-${p.v}`,
                at: p.at - 1,
                node: (
                  <Event dot="you" title={<span className="font-semibold">Asked for changes</span>}>
                    <p className="max-w-[68ch] text-[13.5px] leading-relaxed break-words whitespace-pre-wrap">
                      {p.note}
                    </p>
                  </Event>
                ),
              },
            ]
          : []),
        {
          key: `plan-${p.v}`,
          at: p.at,
          node: (
            <Event
              dot={waiting ? 'wait' : 'step'}
              title={
                <>
                  <span className="font-semibold">{p.v === 1 ? 'Planned' : 'Revised the plan'}</span>
                  {plans.length > 1 && <span className="text-ink-soft"> · v{p.v}</span>}
                  {waiting && ' · waiting for you'}
                </>
              }
              time={ago(p.at, now)}
              actions={
                <>
                  {outputButton(`plan-${p.v}`)}
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => {
                      if (open) return togglePlan(true)
                      onVersion(p.v === latest ? null : p.v)
                      togglePlan(false)
                    }}
                    className={`h-8 rounded-lg px-3 text-[12.5px] font-medium ${
                      open ? 'text-ink-soft hover:bg-line-soft hover:text-ink' : 'border border-line hover:bg-line-soft'
                    }`}
                  >
                    {open ? 'Hide' : 'Show plan'}
                  </button>
                </>
              }
            >
              {output(`plan-${p.v}`)}
              {open && plan && (
                <div className="overflow-hidden rounded-xl border border-line">
                  <PlanFrame title={`Plan v${plan.v}`} html={plan.html} />
                </div>
              )}
            </Event>
          ),
        },
      ]
    }),
    ...(changedAt && t.changedFiles
      ? [
          {
            key: 'changed',
            at: changedAt,
            node: (
              <Event
                dot={t.stage === 'check' ? 'wait' : 'step'}
                title={
                  <>
                    <span className="font-semibold">
                      Changed {t.changedFiles.length} {t.changedFiles.length === 1 ? 'file' : 'files'}
                    </span>
                    {t.stage === 'check' && ' · waiting for you'}
                  </>
                }
                time={ago(changedAt, now)}
                actions={outputButton('changed')}
              >
                <ul className="flex flex-wrap gap-1.5">
                  {t.changedFiles.map((f) => (
                    <li
                      key={f}
                      className="rounded-lg border border-line-soft bg-bg/60 px-2.5 py-1 font-mono text-xs break-all"
                    >
                      {f}
                    </li>
                  ))}
                </ul>
                {output('changed')}
              </Event>
            ),
          },
        ]
      : []),
    ...(isClosed(t)
      ? [
          {
            key: 'closed',
            at: lastStep + 0.5,
            node: (
              <Event
                dot={t.stage === 'done' ? 'ok' : 'muted'}
                title={
                  t.stage === 'done' ? (
                    <span className="font-semibold text-ok">{t.closedReason ?? 'Done'}</span>
                  ) : (
                    <span className="font-semibold text-ink-soft">{t.closedReason ?? 'Dismissed'}</span>
                  )
                }
              />
            ),
          },
        ]
      : []),
    ...followUps.map((f) => ({
      key: `follow-${f.id}`,
      at: f.createdAt,
      node: (
        <Event dot="you" title={<span className="font-semibold">Followed up</span>} time={ago(f.createdAt, now)}>
          <p className="max-w-[68ch] text-[13.5px] leading-relaxed break-words whitespace-pre-wrap">
            {f.original ?? f.title}
          </p>
          <button
            type="button"
            onClick={() => onOpenTask(f.id)}
            className="inline-flex min-h-8 items-center gap-2 self-start text-[12.5px] text-ink-soft hover:text-ink hover:underline"
          >
            <span
              aria-hidden="true"
              className={`size-[7px] rounded-full bg-ink-soft ${STAGE[f.stage].working ? 'animate-pulse' : ''}`}
            />
            {STAGE[f.stage].label} · Open →
          </button>
        </Event>
      ),
    })),
    ...(working
      ? [
          {
            key: 'working',
            at: Infinity,
            node: (
              <Event dot="working" title={<span className="font-semibold">{stage.label}</span>}>
                {outputOf.working?.length ? <LogBox lines={outputOf.working} /> : null}
              </Event>
            ),
          },
        ]
      : []),
  ].sort((a, b) => a.at - b.at)

  return (
    <section aria-labelledby="task-h" className="flex flex-grow flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onClose}
          className="-ml-2 inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase hover:bg-line-soft hover:text-ink"
        >
          Collapse <span aria-hidden="true">→</span>
        </button>
      </div>

      <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
        <header className="flex flex-col gap-3 border-b border-line p-5">
          <div className="flex items-center justify-between gap-2 text-xs text-ink-soft">
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
              {/* Only say where it came from when it wasn't you: a crash, a sync. Follow-ups link their parent below. */}
              {t.sourceLabel !== 'You' && !parent && (
                <>
                  <Icon />
                  {t.sourceLabel} ·{' '}
                </>
              )}
              {ago(t.lastSeenAt ?? t.createdAt, now)} ·{' '}
              {/* Which Claude does its next steps; change it here. */}
              <ModelPicker
                compact
                model={t.model ?? 'default'}
                onPick={(m) => void send({ type: 'model', model: m })}
              />
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

        <div className="relative border-b border-line px-5 py-2">
          <span aria-hidden="true" className="absolute top-7 bottom-7 left-[31.5px] w-px bg-line" />
          <ol aria-label="What happened" className="relative flex flex-col">
            {events.map((e) => (
              <Fragment key={e.key}>{e.node}</Fragment>
            ))}
          </ol>
        </div>

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
      </div>
    </section>
  )
}

/** How each moment is marked on the line: yours, a step of the work, done, waiting on you, closed, or going on now. */
const DOT = {
  you: 'bg-ink',
  step: 'border-[1.5px] border-ink bg-surface',
  ok: 'bg-ok',
  wait: 'bg-warn',
  muted: 'bg-ink-faint',
  working: 'animate-pulse bg-ink-soft',
}

/** One moment in the task's story: a dot on the line, what happened, when, and what you can open. */
function Event({
  dot,
  title,
  time,
  actions,
  children,
}: {
  dot: keyof typeof DOT
  title: ReactNode
  time?: string
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <li className="flex gap-3.5 py-2.5">
      <span aria-hidden="true" className="flex w-6 flex-none justify-center pt-[11px]">
        <span className={`size-[9px] rounded-full ${DOT[dot]}`} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 text-[13px]">
          <span className="min-w-0">{title}</span>
          <span className="flex items-center gap-1.5">
            {actions}
            {time && <span className="min-w-14 text-right text-xs text-ink-soft">{time}</span>}
          </span>
        </div>
        {children}
      </div>
    </li>
  )
}

const LEVEL = {
  info: 'text-ink',
  ok: 'text-ok',
  warn: 'text-ink-soft',
  err: 'text-err',
}

/** Claude's output for one step, kept scrolled to the newest line. */
function LogBox({ lines }: { lines: LogLine[] }) {
  const box = useRef<HTMLDivElement>(null)
  const last = lines.at(-1)?.seq
  useEffect(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [last])
  return (
    <div
      ref={box}
      role="log"
      aria-label="Output"
      className="max-h-[320px] overflow-auto rounded-[10px] border border-line-soft bg-bg/60 px-3.5 py-2.5 font-mono text-[11.5px] leading-[1.75]"
    >
      {lines.map((l) => (
        <div key={l.seq} className={`flex gap-3.5 whitespace-pre-wrap ${LEVEL[l.level]}`}>
          <span className="flex-none text-ink-soft">{clock(l.t)}</span>
          <span className="min-w-0 break-words">{l.text}</span>
        </div>
      ))}
    </div>
  )
}
