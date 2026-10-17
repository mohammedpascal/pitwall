import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Task, TaskStatus } from './types'

const DIR = path.join(process.cwd(), '.pitwall')
const FILE = path.join(DIR, 'tasks.json')

/** Older files used new / approved / rejected; those map onto open / done. */
function normalize(t: Task): Task {
  const status = t.status as string
  if (status === 'open' || status === 'done') return t
  return { ...t, status: status === 'new' ? 'open' : 'done' }
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
  fs.writeFileSync(FILE, JSON.stringify(tasks, null, 2))
}

const seen = (t: Task) => t.lastSeenAt ?? t.createdAt

export function list(projectId: string) {
  return read()
    .filter((t) => t.projectId === projectId)
    .sort((a, b) => seen(b) - seen(a))
}

export function add(input: Omit<Task, 'id' | 'createdAt' | 'status'>) {
  const task: Task = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    status: 'open',
  }
  write([task, ...read()])
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
    (t) => t.status === 'open' && t.projectId === input.projectId && t.signature === input.signature,
  )
  if (open) {
    write(
      tasks.map((t) =>
        t === open ? { ...t, count: (t.count ?? 1) + 1, lastSeenAt: Date.now(), detail: input.detail } : t,
      ),
    )
    return
  }
  add({ ...input, source: 'terminal', count: 1, lastSeenAt: Date.now() })
}

export function setStatus(id: string, status: TaskStatus) {
  write(read().map((t) => (t.id === id ? { ...t, status } : t)))
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
