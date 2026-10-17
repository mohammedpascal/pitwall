import path from 'node:path'
import { createServerFn } from '@tanstack/react-start'
import fs from 'node:fs'
import {
  displayPath,
  expand,
  findProject,
  loadConfig,
  rawProject,
  removeProject as removeFromConfig,
  saveProject,
  serviceCwd,
  updateProject as updateInConfig,
} from './config'
import { scanFolder, slug, suggestFolders } from './scan'
import * as pm from './processes'
import * as tasks from './tasks'
import type {
  EditableProject,
  NewProjectInput,
  ProjectState,
  ProjectSummary,
  ServiceView,
  TaskSource,
  TaskStatus,
} from './types'

const key = (projectId: string, serviceId: string) => `${projectId}:${serviceId}`

function requireProject(id: string) {
  const project = findProject(id)
  if (!project) throw new Error(`Unknown project: ${id}`)
  return project
}

export const getProjects = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ProjectSummary[]> =>
    loadConfig().projects.map((p) => ({
      id: p.id,
      name: p.name,
      running: p.services.filter((s) => {
        const st = pm.view(key(p.id, s.id)).status
        return st === 'running' || st === 'starting'
      }).length,
    })),
)

export const getProjectState = createServerFn({ method: 'GET' })
  .validator((d: { projectId: string; logService?: string }) => d)
  .handler(async ({ data }): Promise<ProjectState | null> => {
    const config = loadConfig()
    const project = config.projects.find((p) => p.id === data.projectId)
    if (!project) return null

    const services: ServiceView[] = project.services.map((s) => {
      const rel = path.relative(project.path, serviceCwd(project, s))
      return {
        id: s.id,
        name: s.name,
        command: s.command,
        cwdLabel: rel || '.',
        ...pm.view(key(project.id, s.id)),
      }
    })

    const logService =
      services.find((s) => s.id === data.logService)?.id ??
      services.find((s) => s.status === 'error')?.id ??
      services[0]?.id ??
      null

    return {
      id: project.id,
      name: project.name,
      path: displayPath(project.path),
      services,
      logService,
      logs: logService ? pm.logs(key(project.id, logService)) : [],
      tasks: tasks.list(project.id),
      configSource: config.source,
    }
  })

type ServiceRef = { projectId: string; serviceId: string }

export const startService = createServerFn({ method: 'POST' })
  .validator((d: ServiceRef) => d)
  .handler(async ({ data }) => {
    const project = requireProject(data.projectId)
    const s = project.services.find((x) => x.id === data.serviceId)
    if (!s) throw new Error(`Unknown service: ${data.serviceId}`)
    pm.start(key(project.id, s.id), s.command, serviceCwd(project, s))
  })

export const stopService = createServerFn({ method: 'POST' })
  .validator((d: ServiceRef) => d)
  .handler(async ({ data }) => {
    pm.stop(key(data.projectId, data.serviceId))
  })

export const startAll = createServerFn({ method: 'POST' })
  .validator((d: { projectId: string }) => d)
  .handler(async ({ data }) => {
    const project = requireProject(data.projectId)
    for (const s of project.services) {
      pm.start(key(project.id, s.id), s.command, serviceCwd(project, s))
    }
  })

export const stopAll = createServerFn({ method: 'POST' })
  .validator((d: { projectId: string }) => d)
  .handler(async ({ data }) => {
    const project = requireProject(data.projectId)
    for (const s of project.services) pm.stop(key(project.id, s.id))
  })

export const addTask = createServerFn({ method: 'POST' })
  .validator((d: { projectId: string; title: string }) => d)
  .handler(async ({ data }) => {
    const title = data.title.trim()
    if (!title) throw new Error('A task needs a description')
    requireProject(data.projectId)
    return tasks.add({
      projectId: data.projectId,
      title,
      source: 'manual' satisfies TaskSource,
      sourceLabel: 'You',
    })
  })

export const setTaskStatus = createServerFn({ method: 'POST' })
  .validator((d: { id: string; status: TaskStatus }) => d)
  .handler(async ({ data }) => {
    tasks.setStatus(data.id, data.status)
  })

/** Turn a crashed service's recent output into a task. */
export const sendErrorToTask = createServerFn({ method: 'POST' })
  .validator((d: ServiceRef) => d)
  .handler(async ({ data }) => {
    const project = requireProject(data.projectId)
    const s = project.services.find((x) => x.id === data.serviceId)
    if (!s) throw new Error(`Unknown service: ${data.serviceId}`)

    const recent = pm.logs(key(project.id, s.id), 40)
    const lastRun = recent.slice(
      Math.max(0, recent.map((l) => l.text.startsWith('$ ')).lastIndexOf(true)),
    )
    // Prefer a real error message ("TypeError: …") over other lines flagged as errors.
    const errLines = lastRun.filter(
      (l) => l.level === 'err' && !/^\s+at\s/.test(l.text) && !l.text.startsWith('Process exited'),
    )
    const firstError =
      errLines.find((l) => /^\s*(\w*(Error|Exception)|ERR!)\b/.test(l.text)) ?? errLines[0]
    const exit = pm.view(key(project.id, s.id)).exitCode
    const title = firstError
      ? `${s.name}: ${firstError.text.trim().slice(0, 140)}`
      : `${s.name} exited with code ${exit ?? '?'}`

    return tasks.add({
      projectId: project.id,
      title,
      detail: lastRun.map((l) => l.text).join('\n').slice(-4000),
      source: 'terminal',
      sourceLabel: `Terminal · ${s.name}`,
    })
  })

export const listFolders = createServerFn({ method: 'GET' })
  .validator((d: { input: string }) => d)
  .handler(async ({ data }) => suggestFolders(data.input))

export const scanProject = createServerFn({ method: 'POST' })
  .validator((d: { path: string }) => d)
  .handler(async ({ data }) => scanFolder(data.path))

/** Clean up service rows and give each a unique id, keeping ids that already exist. */
function cleanServices(services: NewProjectInput['services']) {
  const ids = new Set<string>()
  return services
    .map((s) => ({ ...s, name: s.name.trim(), command: s.command.trim(), cwd: s.cwd.trim() }))
    .filter((s) => s.name && s.command)
    .map((s) => {
      const base = slug(s.id || s.name)
      let id = base
      for (let i = 2; ids.has(id); i++) id = `${base}-${i}`
      ids.add(id)
      return { id, name: s.name, command: s.command, ...(s.cwd && s.cwd !== '.' ? { cwd: s.cwd } : {}) }
    })
}

export const addProject = createServerFn({ method: 'POST' })
  .validator((d: NewProjectInput) => d)
  .handler(async ({ data }) => {
    const name = data.name.trim()
    if (!name) throw new Error('Give the project a name')
    const id = slug(data.id || name)
    saveProject({ id, name, path: displayPath(data.path), services: cleanServices(data.services) })
    return { id }
  })

export const getEditableProject = createServerFn({ method: 'GET' })
  .validator((d: { projectId: string }) => d)
  .handler(async ({ data }): Promise<EditableProject | null> => {
    const raw = rawProject(data.projectId)
    if (!raw) return null
    return {
      id: raw.id,
      name: raw.name,
      path: raw.path,
      services: (raw.services ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        command: s.command,
        cwd: s.cwd ?? '',
      })),
      running: (raw.services ?? [])
        .filter((s) => {
          const st = pm.view(key(raw.id, s.id)).status
          return st === 'running' || st === 'starting'
        })
        .map((s) => s.id),
      taskCount: tasks.list(raw.id).length,
      configSource: loadConfig().source,
    }
  })

export const updateProject = createServerFn({ method: 'POST' })
  .validator((d: NewProjectInput) => d)
  .handler(async ({ data }) => {
    const before = findProject(data.id)
    if (!before) throw new Error(`Unknown project: ${data.id}`)
    const name = data.name.trim()
    if (!name) throw new Error('Give the project a name')
    const dir = expand(data.path.trim())
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new Error(`No folder at ${displayPath(dir)}`)
    }
    const services = cleanServices(data.services)
    // Services that are gone from the project shouldn't keep running.
    const kept = new Set(services.map((s) => s.id))
    for (const s of before.services) if (!kept.has(s.id)) pm.stop(key(before.id, s.id))
    updateInConfig(data.id, { id: data.id, name, path: displayPath(dir), services })
    return { id: data.id }
  })

export const removeProject = createServerFn({ method: 'POST' })
  .validator((d: { projectId: string }) => d)
  .handler(async ({ data }) => {
    const project = findProject(data.projectId)
    if (!project) return
    for (const s of project.services) pm.stop(key(project.id, s.id))
    tasks.removeForProject(project.id)
    removeFromConfig(project.id)
  })
