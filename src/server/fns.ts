import fs from 'node:fs'
import path from 'node:path'
import { createServerFn } from '@tanstack/react-start'
import {
  displayPath,
  expand,
  findProject,
  insertProject,
  loadConfig,
  rawProject,
  removeProject as removeFromConfig,
  serviceCwd,
  updateProject,
} from './config'
import { expoQr } from './expo'
import { launch, launchAll } from './launch'
import * as pm from './processes'
import { scanFolder, slug, suggestFolders } from './scan'
import { startLifecycle } from './lifecycle'
import * as tasks from './tasks'
import type {
  DetectedService,
  OpenResult,
  ProjectConfig,
  ProjectState,
  ProjectSummary,
  RemovedProject,
  RemovedService,
  ServiceConfig,
  ServiceStatus,
  ServiceView,
  TaskStatus,
} from './types'

const key = (projectId: string, serviceId: string) => `${projectId}:${serviceId}`
const isUp = (st: ServiceStatus) => st === 'running' || st === 'starting'

function requireProject(id: string) {
  const project = findProject(id)
  if (!project) throw new Error(`Unknown project: ${id}`)
  return project
}

function requireFolder(input: string) {
  const dir = expand(input.trim())
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`No folder at ${displayPath(dir)}`)
  }
  return dir
}

function uniqueServiceId(taken: Iterable<string>, base: string) {
  const ids = new Set(taken)
  const root = slug(base)
  let id = root
  for (let i = 2; ids.has(id); i++) id = `${root}-${i}`
  return id
}

function toConfig(s: { id: string; name: string; command: string; cwd: string }): ServiceConfig {
  return { id: s.id, name: s.name, command: s.command, ...(s.cwd && s.cwd !== '.' ? { cwd: s.cwd } : {}) }
}



// ── Reading ─────────────────────────────────────────────────────────────────

export const getProjects = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ProjectSummary[]> => {
    startLifecycle()
    return loadConfig().map((p) => ({
      id: p.id,
      name: p.name,
      running: p.services.filter((s) => isUp(pm.view(key(p.id, s.id)).status)).length,
    }))
  },
)

export const getProjectState = createServerFn({ method: 'GET' })
  .validator((d: { projectId: string; logService?: string }) => d)
  .handler(async ({ data }): Promise<ProjectState | null> => {
    const project = findProject(data.projectId)
    if (!project) return null

    const services: ServiceView[] = await Promise.all(
      project.services.map(async (s) => {
        const k = key(project.id, s.id)
        const view = pm.view(k)
        const qr =
          view.status === 'running'
            ? await expoQr({ key: k, command: s.command, cwd: serviceCwd(project, s), url: view.url, startedAt: view.startedAt })
            : null
        return { id: s.id, name: s.name, command: s.command, ...view, qr }
      }),
    )

    const logService =
      services.find((s) => s.id === data.logService)?.id ??
      services.find((s) => s.status === 'error')?.id ??
      services.find((s) => isUp(s.status))?.id ??
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
    }
  })

export const listFolders = createServerFn({ method: 'GET' })
  .validator((d: { input: string }) => d)
  .handler(async ({ data }) => suggestFolders(data.input))

const suggestionKey = (s: { cwd?: string; command: string }) => `${s.cwd || '.'}|${s.command}`

/** Services in the project's folder that aren't in the project yet, e.g. "worker:dev". */
export const getSuggestions = createServerFn({ method: 'GET' })
  .validator((d: { projectId: string }) => d)
  .handler(async ({ data }): Promise<DetectedService[]> => {
    const project = findProject(data.projectId)
    if (!project) return []
    let found: DetectedService[]
    try {
      found = scanFolder(project.path).services
    } catch {
      return []
    }
    const have = new Set(project.services.map(suggestionKey))
    const folders = new Set(project.services.map((s) => s.cwd || '.'))
    const ignored = new Set(project.ignore ?? [])
    return found.filter(
      (s) =>
        !have.has(suggestionKey(s)) &&
        !ignored.has(suggestionKey(s)) &&
        // A folder's main service with an edited command is still the same service.
        !(s.enabled && folders.has(s.cwd || '.')),
    )
  })

// ── Running ─────────────────────────────────────────────────────────────────

type ServiceRef = { projectId: string; serviceId: string }

export const startService = createServerFn({ method: 'POST' })
  .validator((d: ServiceRef) => d)
  .handler(async ({ data }) => {
    const project = requireProject(data.projectId)
    const s = project.services.find((x) => x.id === data.serviceId)
    if (!s) throw new Error(`Unknown service: ${data.serviceId}`)
    await launch(project, s)
  })

export const stopService = createServerFn({ method: 'POST' })
  .validator((d: ServiceRef) => d)
  .handler(async ({ data }) => {
    pm.stop(key(data.projectId, data.serviceId))
  })

export const startAll = createServerFn({ method: 'POST' })
  .validator((d: { projectId: string }) => d)
  .handler(async ({ data }) => launchAll(requireProject(data.projectId)))

export const stopAll = createServerFn({ method: 'POST' })
  .validator((d: { projectId: string }) => d)
  .handler(async ({ data }) => {
    const project = requireProject(data.projectId)
    for (const s of project.services) pm.stop(key(project.id, s.id))
  })

// ── Projects ────────────────────────────────────────────────────────────────

/** Open a folder: scan it, add it as a project and start its services. */
export const openProject = createServerFn({ method: 'POST' })
  .validator((d: { path: string }) => d)
  .handler(async ({ data }): Promise<OpenResult> => {
    const dir = requireFolder(data.path)
    const existing = loadConfig().find((p) => p.path === dir)
    if (existing) return { status: 'opened', id: existing.id, existing: true }

    const scan = scanFolder(dir)
    const services = scan.services.filter((s) => s.enabled)
    if (!services.length) {
      return { status: 'empty', path: dir, displayPath: scan.displayPath, name: scan.suggestedName }
    }
    const project: ProjectConfig = {
      id: scan.suggestedId,
      name: scan.suggestedName,
      path: displayPath(dir),
      services: services.map(toConfig),
    }
    insertProject(project)
    await launchAll({ ...project, path: dir })
    return { status: 'opened', id: project.id, existing: false }
  })

/** Create a project by hand when the scan found nothing to run. */
export const createProject = createServerFn({ method: 'POST' })
  .validator((d: { path: string; name: string; service: { name: string; command: string } }) => d)
  .handler(async ({ data }) => {
    const dir = requireFolder(data.path)
    const name = data.name.trim() || path.basename(dir)
    const sName = data.service.name.trim()
    const command = data.service.command.trim()
    if (!sName || !command) throw new Error('A service needs a name and a command')
    const taken = new Set(loadConfig().map((p) => p.id))
    const id = uniqueServiceId(taken, path.basename(dir))
    const project: ProjectConfig = {
      id,
      name,
      path: displayPath(dir),
      services: [{ id: slug(sName), name: sName, command }],
    }
    insertProject(project)
    await launchAll({ ...project, path: dir })
    return { id }
  })

export const updateProjectInfo = createServerFn({ method: 'POST' })
  .validator((d: { projectId: string; name?: string; path?: string }) => d)
  .handler(async ({ data }) => {
    const name = data.name?.trim()
    if (data.name !== undefined && !name) throw new Error('A project needs a name')
    const dir = data.path !== undefined ? requireFolder(data.path) : undefined
    updateProject(data.projectId, (p) => ({
      ...p,
      ...(name ? { name } : {}),
      ...(dir ? { path: displayPath(dir) } : {}),
    }))
  })

export const removeProject = createServerFn({ method: 'POST' })
  .validator((d: { projectId: string }) => d)
  .handler(async ({ data }): Promise<RemovedProject | null> => {
    const project = findProject(data.projectId)
    if (!project) return null
    for (const s of project.services) pm.stop(key(project.id, s.id))
    const removed = removeFromConfig(project.id)
    if (!removed) return null
    return { ...removed, tasks: tasks.removeForProject(project.id) }
  })

export const restoreProject = createServerFn({ method: 'POST' })
  .validator((d: RemovedProject) => d)
  .handler(async ({ data }) => {
    insertProject(data.project, data.index)
    tasks.restore(data.tasks)
    return { id: data.project.id }
  })

// ── Services ────────────────────────────────────────────────────────────────

export const addService = createServerFn({ method: 'POST' })
  .validator((d: { projectId: string; service: { name: string; command: string; cwd: string } }) => d)
  .handler(async ({ data }) => {
    const name = data.service.name.trim()
    const command = data.service.command.trim()
    if (!name || !command) throw new Error('A service needs a name and a command')
    const project = rawProject(data.projectId)
    if (!project) throw new Error(`Unknown project: ${data.projectId}`)
    const id = uniqueServiceId(project.services.map((s) => s.id), name)
    updateProject(data.projectId, (p) => ({
      ...p,
      services: [...p.services, toConfig({ id, name, command, cwd: data.service.cwd.trim() })],
    }))
    return { id }
  })

export const ignoreSuggestion = createServerFn({ method: 'POST' })
  .validator((d: { projectId: string; service: { cwd: string; command: string } }) => d)
  .handler(async ({ data }) => {
    const k = suggestionKey(data.service)
    updateProject(data.projectId, (p) => ({ ...p, ignore: [...new Set([...(p.ignore ?? []), k])] }))
  })

export const updateService = createServerFn({ method: 'POST' })
  .validator((d: ServiceRef & { name?: string; command?: string }) => d)
  .handler(async ({ data }) => {
    const name = data.name?.trim()
    const command = data.command?.trim()
    if (data.name !== undefined && !name) throw new Error('A service needs a name')
    if (data.command !== undefined && !command) throw new Error('A service needs a command')
    updateProject(data.projectId, (p) => ({
      ...p,
      services: p.services.map((s) =>
        s.id === data.serviceId ? { ...s, ...(name ? { name } : {}), ...(command ? { command } : {}) } : s,
      ),
    }))
  })

export const removeService = createServerFn({ method: 'POST' })
  .validator((d: ServiceRef) => d)
  .handler(async ({ data }): Promise<RemovedService | null> => {
    const project = rawProject(data.projectId)
    const index = project?.services.findIndex((s) => s.id === data.serviceId) ?? -1
    if (!project || index === -1) return null
    pm.stop(key(data.projectId, data.serviceId))
    const service = project.services[index]
    updateProject(data.projectId, (p) => ({ ...p, services: p.services.filter((s) => s.id !== data.serviceId) }))
    return { projectId: data.projectId, service, index }
  })

export const restoreService = createServerFn({ method: 'POST' })
  .validator((d: RemovedService) => d)
  .handler(async ({ data }) => {
    updateProject(data.projectId, (p) => {
      if (p.services.some((s) => s.id === data.service.id)) return p
      const services = [...p.services]
      services.splice(data.index, 0, data.service)
      return { ...p, services }
    })
  })

// ── Tasks ───────────────────────────────────────────────────────────────────

export const addTask = createServerFn({ method: 'POST' })
  .validator((d: { projectId: string; title: string }) => d)
  .handler(async ({ data }) => {
    const title = data.title.trim()
    if (!title) throw new Error('A task needs a description')
    requireProject(data.projectId)
    return tasks.add({ projectId: data.projectId, title, source: 'manual', sourceLabel: 'You' })
  })

export const setTaskStatus = createServerFn({ method: 'POST' })
  .validator((d: { id: string; status: TaskStatus }) => d)
  .handler(async ({ data }) => {
    tasks.setStatus(data.id, data.status)
  })
