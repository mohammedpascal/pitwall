import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Task, TaskStatus } from './types'

const DIR = path.join(process.cwd(), '.pitwall')
const FILE = path.join(DIR, 'tasks.json')

function read(): Task[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as Task[]
  } catch {
    return []
  }
}

function write(tasks: Task[]) {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(tasks, null, 2))
}

export function list(projectId: string) {
  return read()
    .filter((t) => t.projectId === projectId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function add(input: Omit<Task, 'id' | 'createdAt' | 'status'>) {
  const task: Task = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    status: 'new',
  }
  write([task, ...read()])
  return task
}

export function setStatus(id: string, status: TaskStatus) {
  write(read().map((t) => (t.id === id ? { ...t, status } : t)))
}

export function removeForProject(projectId: string) {
  write(read().filter((t) => t.projectId !== projectId))
}
