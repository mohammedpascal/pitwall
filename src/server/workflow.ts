import fs from 'node:fs'
import path from 'node:path'
import * as agent from './agent'
import { dir as attachmentDir } from './attachments'
import { findProject } from './config'
import { launch } from './launch'
import * as pm from './processes'
import * as tasks from './tasks'
import type { Task, TaskKind, TaskStart } from './types'

/**
 * A task's life: understood as soon as it arrives, planned when you ask, done
 * when you say so. Small ones can skip straight to doing (see start). Each step is one Claude Code run in the project's folder;
 * all of a task's runs share one conversation.
 */

const PLANS = path.join(process.cwd(), '.pitwall', 'plans')

export const planFile = (taskId: string, v: number) => path.join(PLANS, taskId, `v${v}.html`)

export function readPlan(taskId: string, v: number) {
  try {
    return fs.readFileSync(planFile(taskId, v), 'utf8')
  } catch {
    return null
  }
}

function projectDir(task: Task) {
  const project = findProject(task.projectId)
  if (!project) throw new Error('This task’s project is gone')
  return project
}

/** Lets Claude read the task's attachments, which live outside the project. */
const readable = (task: Task) => (task.attachments?.length ? [attachmentDir(task.id)] : [])

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * A follow-up starts on its parent's conversation. Its first run forks it, so the
 * parent's stays as it was; later runs continue the fork.
 */
function session(task: Task) {
  const parent = task.parentId ? tasks.get(task.parentId) : null
  return {
    sessionId: task.sessionId,
    fork: !!task.sessionId && task.sessionId === parent?.sessionId,
  }
}

function describe(task: Task) {
  const files = (task.attachments ?? []).map(
    (a) => `- ${path.join(attachmentDir(task.id), a.file)} (${a.name}, ${a.type})`,
  )
  return [
    `Task: ${task.original ?? task.title}`,
    task.title !== task.original ? `Rewritten as: ${task.title}` : '',
    `From: ${task.sourceLabel}`,
    files.length
      ? `Attached by the person (read every one; images are usually screenshots of the problem):\n${files.join('\n')}`
      : '',
    task.detail ? `Output from when it happened:\n${task.detail.slice(-3000)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

// ── Understand ──────────────────────────────────────────────────────────────

const UNDERSTAND_SCHEMA = {
  type: 'object',
  properties: {
    actionable: {
      type: 'boolean',
      description: 'false only for noise: not a real problem, already fixed, or nothing anyone could do',
    },
    kind: { type: 'string', enum: ['bug', 'change', 'question'] },
    simple: {
      type: 'boolean',
      description: 'true when the change is small and obvious enough to make without a plan: a copy change, a one-line fix, a rename',
    },
    title: { type: 'string', description: 'Short, plain, specific title, under 70 characters' },
    summary: {
      type: 'string',
      description: 'One short paragraph: what is wrong or wanted, and where in the code, in plain words',
    },
    duplicateOf: { type: 'string', description: 'Id of an open task this repeats, or empty' },
    reason: { type: 'string', description: 'When not actionable or a duplicate: why, in a few words' },
  },
  required: ['actionable', 'kind', 'simple', 'title', 'summary', 'duplicateOf', 'reason'],
}

export async function understand(task: Task) {
  const project = projectDir(task)
  tasks.update(task.id, { stage: 'understanding', error: undefined })
  agent.note(task.id, 'Reading the task…', 'ok')

  const others = tasks
    .list(task.projectId)
    .filter((t) => t.id !== task.id && t.status === 'open')
    .map((t) => `- ${t.id}: ${t.title}`)
    .join('\n')

  // A follow-up continues a copy of its parent's conversation, so Claude already has the context.
  const parent = task.parentId ? tasks.get(task.parentId) : null
  const followUp = !!(parent && task.sessionId)

  const prompt = `${
    followUp
      ? `New task: a follow-up to the task we just worked on ("${parent?.title}"). Treat it as its own task, using what you already know from this conversation.`
      : `You are triaging a task for the project in this folder (${project.name}).`
  } Do not change anything.

${describe(task)}

Look at the relevant code just enough to understand it. Decide:
- kind: bug (something broken), change (something to add or alter) or question.
- whether it is actionable. A feature request is actionable. Only noise, something already fixed, or something nobody could act on is not.
- whether it repeats one of these open tasks:
${others || '(none)'}

Rewrite the title so anyone on the team understands it at a glance, and summarise it in one short paragraph.`

  try {
    const r = await agent.runClaude({
      taskId: task.id,
      cwd: project.path,
      prompt,
      mode: 'read',
      schema: UNDERSTAND_SCHEMA,
      addDirs: readable(task),
      ...session(task),
    })
    const out = r.output as {
      actionable: boolean
      kind: TaskKind
      simple: boolean
      title: string
      summary: string
      duplicateOf: string
      reason: string
    } | null
    if (!out) throw new Error('Claude didn’t return an answer')
    const dup = out.duplicateOf ? tasks.get(out.duplicateOf) : null
    const closed = (dup && dup.status === 'open') || !out.actionable
    tasks.update(task.id, {
      sessionId: r.sessionId,
      kind: out.kind,
      simple: out.simple,
      title: out.title.trim() || task.title,
      summary: out.summary.trim(),
      stage: closed ? 'dismissed' : 'ready',
      closedReason: dup ? `Same as “${dup.title}”` : !out.actionable ? out.reason || 'Not actionable' : undefined,
    })
    agent.note(task.id, closed ? 'Closed it: nothing new to do.' : 'Understood.', 'ok')
  } catch (e) {
    // Still workable: you can plan it as written.
    tasks.update(task.id, { stage: 'ready', error: `Couldn’t read it: ${message(e)}` })
    agent.note(task.id, message(e), 'err')
  }
}

// ── Plan ────────────────────────────────────────────────────────────────────

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    html: { type: 'string', description: 'The complete plan page, a full HTML document' },
  },
  required: ['html'],
}

const PLAN_RULES = `Write the plan as one complete HTML page (inline CSS, no external files or scripts, no web fonts).
Style: white background, black text, greys for secondary text, system sans-serif, generous spacing, 8–12px rounded corners, thin #e5e5e5 borders. Minimal, no colours except a quiet red for "before" problems and green for "after".
Sections, in order:
1. Problem — one or two sentences.
2. Before / After — side by side (stacking on narrow screens). For anything visible, draw small HTML mockups of the affected screen as it is now and as it will be, using the app's real labels and layout read from the code. For backend changes, draw the flow as boxes and arrows instead.
3. Steps — a short numbered list of what will change.
4. Files — the files that will be touched, in monospace.
5. Risks — anything that could break, or "None expected".
Keep it to what someone needs to say yes or no. Answer with the HTML only, in the html field.`

export async function plan(task: Task, note?: string) {
  const project = projectDir(task)
  const plans = task.plans ?? []
  const v = plans.length + 1
  const back = plans.length ? 'planned' : 'ready'
  tasks.update(task.id, { stage: 'planning', error: undefined })
  agent.note(task.id, v === 1 ? 'Planning…' : `Revising the plan (v${v})…`, 'ok')

  const ask = note?.trim()
  const prompt =
    v === 1
      ? `Plan the work for this task in the project in this folder (${project.name}). Do not change anything yet.

${describe(task)}${task.summary ? `\n\nYour understanding so far: ${task.summary}` : ''}${ask ? `\n\nGuidance from the person: ${ask}` : ''}

${PLAN_RULES}`
      : `Revise your plan (now version ${v}). Do not change anything yet.${ask ? `\n\nWhat should change: ${ask}` : ''}

${PLAN_RULES}`

  try {
    const r = await agent.runClaude({
      taskId: task.id,
      cwd: project.path,
      prompt,
      ...session(task),
      mode: 'read',
      schema: PLAN_SCHEMA,
      addDirs: readable(task),
    })
    const html = (r.output as { html?: string } | null)?.html
    if (!html?.trim()) throw new Error('Claude didn’t return a plan')
    fs.mkdirSync(path.dirname(planFile(task.id, v)), { recursive: true })
    fs.writeFileSync(planFile(task.id, v), html)
    tasks.update(task.id, (t) => ({
      sessionId: r.sessionId,
      stage: 'planned',
      plans: [...(t.plans ?? []), { v, at: Date.now(), ...(ask ? { note: ask } : {}) }],
    }))
    agent.note(task.id, `Plan v${v} ready.`, 'ok')
  } catch (e) {
    tasks.update(task.id, { stage: back, error: `Couldn’t plan it: ${message(e)}` })
    agent.note(task.id, message(e), 'err')
  }
}

// ── Do it ───────────────────────────────────────────────────────────────────

// Edits to one project run one at a time, so two tasks never write over each other.
const queues = globalThis as unknown as { __pitwallEditQueue?: Map<string, Promise<void>> }
const editQueue = (queues.__pitwallEditQueue ??= new Map())

/** Claude is changing this project (or about to): not a moment to commit it. */
export const editing = (projectId: string) => editQueue.has(projectId)

export function doIt(task: Task, note?: string) {
  const project = projectDir(task)
  const v = task.plans?.at(-1)?.v
  const back = v ? 'planned' : 'ready'
  tasks.update(task.id, { stage: 'doing', error: undefined })
  agent.note(task.id, editQueue.has(project.id) ? 'Waiting for another task to finish…' : 'Working…', 'ok')

  const run = async () => {
    const current = tasks.get(task.id) ?? task
    const ask = note?.trim()
    // With a plan, keep to it; without one, the task as written is the brief.
    const brief = v
      ? `The plan (version ${v}) is approved. Carry it out now in this folder, keeping to the plan.`
      : `Do this task now in the project in this folder (${project.name}). Keep the change as small as the task allows.

${describe(current)}${current.summary ? `\n\nYour understanding so far: ${current.summary}` : ''}`
    const prompt = `${brief}${ask ? `\n\nGuidance from the person: ${ask}` : ''}
Don't start or restart dev servers; Pitwall runs them. When you're done, reply with two or three sentences on what changed.`
    try {
      const r = await agent.runClaude({
        taskId: task.id,
        cwd: project.path,
        prompt,
        ...session(current),
        mode: 'edit',
        addDirs: readable(task),
      })
      // Stopped by something you denied, with nothing changed: it isn't done, so don't say it is.
      if (r.denials.length && !r.changedFiles.length) {
        const what = [...new Set(r.denials)].join(', ')
        tasks.update(task.id, { sessionId: r.sessionId, stage: back, error: `Claude couldn’t finish: not allowed to use ${what}` })
        agent.note(task.id, `Claude couldn’t finish: not allowed to use ${what}.`, 'err')
        return
      }
      tasks.update(task.id, (t) => ({
        sessionId: r.sessionId,
        stage: 'check',
        changedFiles: [...new Set([...(t.changedFiles ?? []), ...r.changedFiles])],
        fixedAt: Date.now(),
      }))
      agent.note(task.id, 'Done. Check it.', 'ok')
      // A crash fix is proven by the service running again: restart it.
      const s = task.serviceId ? project.services.find((x) => x.id === task.serviceId) : null
      if (s && pm.view(`${project.id}:${s.id}`).status !== 'running') {
        agent.note(task.id, `Starting ${s.name} again…`)
        await launch(project, s)
      }
    } catch (e) {
      tasks.update(task.id, { stage: back, error: `Couldn’t finish: ${message(e)}` })
      agent.note(task.id, message(e), 'err')
    }
  }

  const prev = editQueue.get(project.id) ?? Promise.resolve()
  const next = prev.then(run)
  editQueue.set(project.id, next)
  void next.finally(() => {
    if (editQueue.get(project.id) === next) editQueue.delete(project.id)
  })
}

// ── Start ───────────────────────────────────────────────────────────────────

/** A new task goes as far as you asked: read it, read and plan it, or do it now. */
export async function start(task: Task, how: TaskStart) {
  if (how === 'do') return doIt(task)
  await understand(task)
  const fresh = tasks.get(task.id)
  // Closed as noise or a duplicate: nothing to plan.
  if (how === 'plan' && fresh?.stage === 'ready') await plan(fresh)
}

// ── Closing by itself ───────────────────────────────────────────────────────

/** A fixed crash closes once its service has run cleanly for this long. */
const CLEAN_MS = 20_000

export function closeFixedCrashes() {
  for (const t of tasks.all()) {
    if (t.stage !== 'check' || !t.serviceId || !t.fixedAt) continue
    const v = pm.view(`${t.projectId}:${t.serviceId}`)
    // A server stays up after the fix; a script runs to the end without an error.
    const stayedUp =
      v.status === 'running' && !!v.startedAt && v.startedAt >= t.fixedAt - 1000 && Date.now() - v.startedAt > CLEAN_MS
    const finished = v.status === 'stopped' && v.exitCode === 0 && !!v.endedAt && v.endedAt > t.fixedAt
    if (stayedUp || finished) {
      tasks.update(t.id, { stage: 'done', closedReason: 'Fixed: runs cleanly' })
      agent.note(t.id, `It runs cleanly now, so it’s closed.`, 'ok')
    }
  }
}

/** After Pitwall restarts: finish what was interrupted. */
export function resumeInterrupted() {
  for (const t of tasks.all()) {
    if (agent.isRunning(t.id)) continue
    if (t.stage === 'new' || t.stage === 'understanding') void understand(t)
    else if (t.stage === 'planning')
      tasks.update(t.id, { stage: t.plans?.length ? 'planned' : 'ready', error: 'Planning was interrupted' })
    else if (t.stage === 'doing')
      tasks.update(t.id, {
        stage: t.plans?.length ? 'planned' : 'ready',
        error: 'Interrupted while working. Check the files before trying again.',
      })
  }
}
