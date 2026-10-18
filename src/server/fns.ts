import crypto from 'node:crypto'
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
import { expoQr, isExpoApp } from './expo'
import { launch, launchAll } from './launch'
import { webPreview } from './preview'
import { cloudDomain, hostFor } from './cloud'
import * as pm from './processes'
import { scanFolder, slug, suggestFolders } from './scan'
import { startLifecycle } from './lifecycle'
import * as tasks from './tasks'
import { STAGE } from '#/lib/stages'
import * as attachmentStore from './attachments'
import * as agent from './agent'
import * as remote from './remote'
import * as workflow from './workflow'
import { readPlan } from './workflow'
import type {
  AttachmentUpload,
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
  Task,
  TaskDetail,
  TaskStage,
  TaskStart,
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

/** Where the folder box starts: the installer's projects folder on a cloud machine. */
export const getProjectsHome = createServerFn({ method: 'GET' }).handler(async () =>
  cloudDomain() ? '~/projects/' : '~/src/',
)

export const getProjects = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ProjectSummary[]> => {
    startLifecycle()
    const waiting = new Map<string, number>()
    for (const t of tasks.all()) {
      if (STAGE[t.stage].yours) waiting.set(t.projectId, (waiting.get(t.projectId) ?? 0) + 1)
    }
    return loadConfig().map((p) => ({
      id: p.id,
      name: p.name,
      running: p.services.filter((s) => isUp(pm.view(key(p.id, s.id)).status)).length,
      needsYou: waiting.get(p.id) ?? 0,
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
        const running = view.status === 'running'
        const cwd = serviceCwd(project, s)
        // Expo apps open on a phone (QR); web apps open right here (preview).
        const expo = isExpoApp(cwd, s.command)
        const qr =
          running && expo
            ? await expoQr({ key: k, command: s.command, cwd, url: view.url, startedAt: view.startedAt })
            : null
        const local =
          running && !expo ? await webPreview({ key: k, url: view.url, startedAt: view.startedAt }) : null
        // On a cloud machine every link and preview uses the service's public address;
        // the gateway lets Pitwall's preview frame it.
        const host = hostFor(project, s)
        const publicUrl = host ? `https://${host}` : null
        const url = publicUrl && (view.url || isUp(view.status)) ? publicUrl : view.url
        const preview = local && publicUrl ? { url: publicUrl, embeddable: true } : local
        return { id: s.id, name: s.name, command: s.command, ...view, url, qr, preview }
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
      cloud: !!cloudDomain(),
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
  .validator((d: { projectId: string; title: string; attachments?: AttachmentUpload[]; how?: TaskStart }) => d)
  .handler(async ({ data }) => {
    const uploads = data.attachments ?? []
    // Files alone are enough: a screenshot often says it all.
    const title = data.title.trim() || (uploads.length ? `See ${uploads.map((u) => u.name).join(', ')}` : '')
    if (!title) throw new Error('A task needs a description')
    requireProject(data.projectId)
    const id = crypto.randomUUID()
    const attachments = attachmentStore.save(id, uploads)
    const task = tasks.add(
      {
        id,
        projectId: data.projectId,
        title,
        source: 'manual',
        sourceLabel: 'You',
        ...(attachments.length ? { attachments } : {}),
      },
      { understand: false },
    )
    void workflow.start(task, data.how ?? 'read')
    return task
  })

function requireTask(id: string) {
  const task = tasks.get(id)
  if (!task) throw new Error('That task is gone')
  return task
}

/** One writer per conversation: Pitwall's runs wait while you drive it remotely. */
function requireIdle(task: Task, busy = 'Claude is still working on this task') {
  if (agent.isRunning(task.id)) throw new Error(busy)
  if (remote.isOn(task.id)) throw new Error('Stop remote control first')
}

/** Opened in the main panel: the task, Claude's live output, and a plan. */
export const getTaskDetail = createServerFn({ method: 'GET' })
  .validator((d: { id: string; v?: number }) => d)
  .handler(async ({ data }): Promise<TaskDetail | null> => {
    const task = tasks.get(data.id)
    if (!task) return null
    const v = data.v ?? task.plans?.at(-1)?.v
    const html = v ? readPlan(task.id, v) : null
    const parent = task.parentId ? tasks.get(task.parentId) : null
    const followUps = tasks
      .list(task.projectId)
      .filter((t) => t.parentId === task.id)
      .reverse()
      .map((t) => ({ id: t.id, title: t.title, stage: t.stage }))
    return {
      task,
      log: agent.log(task.id),
      plan: v && html ? { v, html } : null,
      working: agent.isRunning(task.id),
      remote: remote.get(task.id),
      parent: parent ? { id: parent.id, title: parent.title } : null,
      followUps,
    }
  })

/** Plan it, or revise the plan, steered by what you typed. */
export const planTask = createServerFn({ method: 'POST' })
  .validator((d: { id: string; note?: string }) => d)
  .handler(async ({ data }) => {
    const task = requireTask(data.id)
    requireIdle(task)
    void workflow.plan(task, data.note)
  })

export const doTask = createServerFn({ method: 'POST' })
  .validator((d: { id: string; note?: string }) => d)
  .handler(async ({ data }) => {
    const task = requireTask(data.id)
    requireIdle(task)
    workflow.doIt(task, data.note)
  })

/** After the work: it's right (done), or it isn't and the plan is revised. */
export const confirmTask = createServerFn({ method: 'POST' })
  .validator((d: { id: string; ok: boolean; note?: string }) => d)
  .handler(async ({ data }) => {
    const task = requireTask(data.id)
    if (data.ok) {
      tasks.update(task.id, { stage: 'done', closedReason: undefined })
      return
    }
    requireIdle(task)
    void workflow.plan(task, `It was done, but it isn't right yet: ${data.note?.trim() || 'look again'}`)
  })

/** A new task that starts from a copy of this one's conversation. */
export const followUpTask = createServerFn({ method: 'POST' })
  .validator((d: { id: string; title: string; how?: TaskStart }) => d)
  .handler(async ({ data }) => {
    const parent = requireTask(data.id)
    const title = data.title.trim()
    if (!title) throw new Error('Say what to follow up with')
    const task = tasks.add(
      {
        projectId: parent.projectId,
        title,
        source: 'manual',
        sourceLabel: 'Follow-up',
        parentId: parent.id,
        ...(parent.sessionId ? { sessionId: parent.sessionId } : {}),
      },
      { understand: false },
    )
    void workflow.start(task, data.how ?? 'do')
    return task.id
  })

/** Close without doing it; returns the stage it had, for undo. */
export const dismissTask = createServerFn({ method: 'POST' })
  .validator((d: { id: string; done?: boolean }) => d)
  .handler(async ({ data }) => {
    const task = requireTask(data.id)
    agent.stop(task.id)
    remote.stop(task.id)
    tasks.update(task.id, data.done ? { stage: 'done', closedReason: undefined } : { stage: 'dismissed', closedReason: 'Dismissed' })
    return task.stage
  })

export const reopenTask = createServerFn({ method: 'POST' })
  .validator((d: { id: string; stage?: TaskStage }) => d)
  .handler(async ({ data }) => {
    const task = requireTask(data.id)
    const busy: TaskStage[] = ['new', 'understanding', 'planning', 'doing']
    const stage = data.stage && !busy.includes(data.stage) ? data.stage : task.plans?.length ? 'planned' : 'ready'
    tasks.update(task.id, { stage, closedReason: undefined })
  })

/** Drive the task's conversation from claude.ai or the Claude app; resolves with the link. */
export const remoteTask = createServerFn({ method: 'POST' })
  .validator((d: { id: string; on: boolean }) => d)
  .handler(async ({ data }) => {
    if (!data.on) {
      remote.stop(data.id)
      return null
    }
    const task = requireTask(data.id)
    const project = findProject(task.projectId)
    if (!project) throw new Error('This task’s project is gone')
    return remote.start(task, project.path)
  })

export const stopTask = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    agent.stop(data.id)
  })

/** Forget Claude's reading and plans, and read the task afresh. */
export const restartTask = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const task = requireTask(data.id)
    requireIdle(task, 'Stop Claude first')
    // A follow-up starts again from its parent's conversation; anything else from nothing.
    const parent = task.parentId ? tasks.get(task.parentId) : null
    const fresh = tasks.update(task.id, {
      title: task.original ?? task.title,
      stage: 'new',
      sessionId: parent?.sessionId,
      summary: undefined,
      kind: undefined,
      simple: undefined,
      plans: undefined,
      error: undefined,
      closedReason: undefined,
    })
    if (fresh) void workflow.understand(fresh)
  })
