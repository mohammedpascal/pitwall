import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Task, TaskStage } from './types'

const DIR = path.join(process.cwd(), '.pitwall')
const FILE = path.join(DIR, 'tasks.json')

const closed = (stage: TaskStage) => stage === 'done' || stage === 'dismissed'

/**
 * Older files have only a status (new / approved / rejected, later open / done).
 * Open ones wait on you as they are; Claude doesn't re-read old tasks.
 */
function normalize(t: Task): Task {
  const status = t.status as string
  const stage: TaskStage =
    t.stage ?? (status === 'open' || status === 'new' ? 'ready' : 'done')
  return { ...t, stage, status: closed(stage) ? 'done' : 'open' }
}

function read(): Task[] {
  try {
    return (JSON.parse(fs.readFileSync(FILE, 'utf8')) as Task[]).map(normalize)
  } catch {
    return []
  }
}

function write(tasks: Task[]) {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(tasks.map(normalize), null, 2))
}

const seen = (t: Task) => t.lastSeenAt ?? t.createdAt

export function list(projectId: string) {
  return read()
    .filter((t) => t.projectId === projectId)
    .sort((a, b) => seen(b) - seen(a))
}

export function all() {
  return read()
}

export function get(id: string) {
  return read().find((t) => t.id === id) ?? null
}

// Told about every new task, so Claude can read it (see lifecycle.ts).
const hooks = globalThis as unknown as { __pitwallOnTask?: (task: Task) => void }

export function onNewTask(fn: (task: Task) => void) {
  hooks.__pitwallOnTask = fn
}

export function add(input: Omit<Task, 'id' | 'createdAt' | 'status' | 'stage'> & { id?: string }) {
  const task: Task = {
    ...input,
    id: input.id ?? crypto.randomUUID(),
    createdAt: Date.now(),
    status: 'open',
    stage: 'new',
    original: input.title,
  }
  write([task, ...read()])
  hooks.__pitwallOnTask?.(task)
  return task
}

/**
 * Record a crash. The same error on the same service bumps the open task's
 * count instead of adding another one, so a crash loop stays one line.
 */
export function recordCrash(input: {
  projectId: string
  serviceId: string
  signature: string
  title: string
  detail: string
  sourceLabel: string
}) {
  const tasks = read()
  const open = tasks.find(
    (t) => !closed(t.stage) && t.projectId === input.projectId && t.signature === input.signature,
  )
  if (open) {
    write(
      tasks.map((t) =>
        t === open
          ? {
              ...t,
              count: (t.count ?? 1) + 1,
              lastSeenAt: Date.now(),
              detail: input.detail,
              // Crashed again after the fix: back to you.
              stage: t.stage === 'check' ? 'planned' : t.stage,
            }
          : t,
      ),
    )
    return
  }
  add({ ...input, source: 'terminal', count: 1, lastSeenAt: Date.now() })
}

export function update(id: string, patch: Partial<Task> | ((t: Task) => Partial<Task>)) {
  let out: Task | null = null
  write(
    read().map((t) => {
      if (t.id !== id) return t
      out = normalize({ ...t, ...(typeof patch === 'function' ? patch(t) : patch) })
      return out
    }),
  )
  return out as Task | null
}

/** Delete a project's tasks and return them, for undo. */
export function removeForProject(projectId: string) {
  const tasks = read()
  write(tasks.filter((t) => t.projectId !== projectId))
  return tasks.filter((t) => t.projectId === projectId)
}

export function restore(restored: Task[]) {
  const ids = new Set(restored.map((t) => t.id))
  write([...restored, ...read().filter((t) => !ids.has(t.id))])
}
