import crypto from 'node:crypto'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import dns from 'node:dns/promises'
import path from 'node:path'
import { createServerFn } from '@tanstack/react-start'
import {
  displayPath,
  expand,
  findProject,
  insertProject,
  isCloud,
  loadConfig,
  markSetupSeen,
  projectsDir,
  publicIp,
  setDomain,
  setupSeen,
  rawProject,
  removeProject as removeFromConfig,
  serviceCwd,
  updateProject,
} from './config'
import { expoQr, isExpoApp } from './expo'
import { launch, launchAll } from './launch'
import { webPreview } from './preview'
import { cloudDomain, hostFor, pitwallHost } from './cloud'
import { hasPassword, newLink, setPassword } from './auth'
import * as certs from './certs'
import * as pm from './processes'
import { scanFolder, slug, suggestFolders } from './scan'
import { startLifecycle } from './lifecycle'
import * as tasks from './tasks'
import { STAGE } from '#/lib/stages'
import * as attachmentStore from './attachments'
import * as agent from './agent'
import * as remote from './remote'
import * as signin from './signin'
import * as git from './git'
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

/** A repository to clone: an https or ssh git URL, or GitHub's owner/repo. */
function gitUrl(input: string): string | null {
  const s = input.trim()
  if (/^(https?:\/\/|git@|ssh:\/\/)\S+\/[^/\s]+$/.test(s)) return s
  if (/^[\w.-]+\/[\w.-]+$/.test(s) && !fs.existsSync(expand(s))) return `https://github.com/${s.replace(/\.git$/, '')}.git`
  return null
}

export interface GithubRepo {
  fullName: string
  description: string | null
  private: boolean
  pushedAt: string
  /** The project it's already open as, if it's in the projects folder. */
  openedId: string | null
}

/** Your GitHub repos, most recently pushed first; empty when GitHub isn't signed in here. */
export const getGithubRepos = createServerFn({ method: 'GET' }).handler(
  (): Promise<{ signedIn: boolean; repos: GithubRepo[] }> =>
    new Promise((resolve) => {
      const url = 'user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member'
      execFile('gh', ['api', url], { env: agent.childEnv(), timeout: 15_000, maxBuffer: 8 << 20 }, (err, stdout) => {
        if (err) return resolve({ signedIn: false, repos: [] })
        const opened = new Map(loadConfig().map((p) => [p.path, p.id]))
        try {
          const list = JSON.parse(stdout) as { full_name: string; name: string; description: string | null; private: boolean; pushed_at: string }[]
          resolve({
            signedIn: true,
            repos: list.map((r) => ({
              fullName: r.full_name,
              description: r.description,
              private: r.private,
              pushedAt: r.pushed_at,
              openedId: opened.get(path.join(projectsDir(), r.name)) ?? null,
            })),
          })
        } catch {
          resolve({ signedIn: true, repos: [] })
        }
      })
    }),
)

/** A new, empty project in the projects folder: nothing runs yet, Claude can build it. */
export const createEmptyProject = createServerFn({ method: 'POST' })
  .validator((d: { name: string }) => d)
  .handler(async ({ data }) => {
    const name = data.name.trim()
    const folder = slug(name)
    if (!folder) throw new Error('Give it a name')
    const dir = path.join(projectsDir(), folder)
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
      throw new Error(`${displayPath(dir)} already exists. Open it from Folder.`)
    }
    fs.mkdirSync(dir, { recursive: true })
    await new Promise<void>((resolve) => execFile('git', ['init', '-q'], { cwd: dir, env: agent.childEnv() }, () => resolve()))
    const id = uniqueServiceId(loadConfig().map((p) => p.id), folder)
    insertProject({ id, name, path: displayPath(dir), services: [] })
    return { id }
  })

/** Clones it into the projects folder, or finds the copy already there. */
function cloneInto(url: string): Promise<string> {
  const name = path.basename(url.replace(/\/+$/, '')).replace(/\.git$/, '')
  const dir = path.join(projectsDir(), name)
  if (fs.existsSync(path.join(dir, '.git'))) return Promise.resolve(dir)
  if (fs.existsSync(dir)) throw new Error(`${displayPath(dir)} already exists and isn’t that repository`)
  fs.mkdirSync(projectsDir(), { recursive: true })
  return new Promise((resolve, reject) => {
    // No terminal to ask for a password: fail fast and say so instead.
    const env = { ...agent.childEnv(), GIT_TERMINAL_PROMPT: '0' }
    execFile('git', ['clone', url, dir], { env, timeout: 10 * 60_000 }, (err, _out, stderr) => {
      if (!err) return resolve(dir)
      // GitHub answers a private repo the same as a missing one.
      if (/could not read Username|Authentication failed|Repository not found|Permission denied/i.test(stderr)) {
        return reject(new Error(`Couldn’t clone ${url}: it doesn’t exist, or it’s private and GitHub isn’t signed in here`))
      }
      const last = stderr.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
      reject(new Error(`Couldn’t clone ${url}${last ? `: ${last.replace(/^fatal: /, '')}` : ''}`))
    })
  })
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

/** Where the folder box starts; ~ stays ~ so it reads short. */
export const getProjectsHome = createServerFn({ method: 'GET' }).handler(async () => {
  const short = displayPath(projectsDir())
  return short.endsWith('/') ? short : short + '/'
})

/** Only on a cloud machine: here you have your own terminal, and Claude and gh are yours already. */
export const getSignIn = createServerFn({ method: 'GET' }).handler(() => (isCloud() ? signin.status() : null))

/** Everything the Setup screen shows. Null on a laptop, which needs no setup. */
export const getSetup = createServerFn({ method: 'GET' }).handler(async () => {
  if (!isCloud()) return null
  const signIn = await signin.status()
  const domain = cloudDomain()
  return {
    signIn,
    domain,
    ip: publicIp(),
    seen: setupSeen(),
    // Optional, so it isn't part of "done": it only saves you SSH on another device.
    password: hasPassword(),
    done: signIn.claude.ok && signIn.github.ok && !!domain,
  }
})

/** A password to sign in from other devices; sessions already signed in stay. */
export const setLoginPassword = createServerFn({ method: 'POST' })
  .validator((d: { password: string }) => d)
  .handler(async ({ data }) => {
    if (!isCloud()) throw new Error('Only a cloud machine has a login')
    setPassword(data.password)
  })

const DOMAIN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/

function cleanDomain(input: string) {
  const d = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^\.+|\.+$/g, '').replace(/\/.*$/, '')
  if (!DOMAIN.test(d)) throw new Error(`“${input.trim()}” isn’t a domain name, like dev.example.com`)
  return d
}

/** Where *.<domain> points. A made-up name checks the wildcard, not one record. */
async function lookUp(domain: string) {
  const ip = publicIp()
  const probe = `check-${crypto.randomBytes(4).toString('hex')}.${domain}`
  const points = await dns
    .resolve4(probe)
    .then((a) => a[0] ?? null)
    .catch(() => null)
  return { domain, ip, points, ok: !!points && (!ip || points === ip) }
}

export const checkDomain = createServerFn({ method: 'POST' })
  .validator((d: { domain: string }) => d)
  .handler(({ data }) => lookUp(cleanDomain(data.domain)))

/** Moves Pitwall to the domain: returns a sign-in link there, since the cookie can't follow by itself. */
export const switchDomain = createServerFn({ method: 'POST' })
  .validator((d: { domain: string }) => d)
  .handler(async ({ data }) => {
    if (!isCloud()) throw new Error('Only a cloud machine has a dev domain')
    // Checked again here: once it's set, this address forwards there, so a wrong domain would lock you out.
    const found = await lookUp(cleanDomain(data.domain))
    if (!found.ok) throw new Error(`*.${found.domain} doesn’t point at this server yet`)
    setDomain(found.domain)
    // Land on a working page: get pitwall.<domain>'s certificate before sending you there.
    await Promise.race([certs.warm(pitwallHost(found.domain)), new Promise((r) => setTimeout(r, 45_000))])
    return { url: `https://${pitwallHost(found.domain)}/login/${newLink()}` }
  })

export const finishSetup = createServerFn({ method: 'POST' }).handler(async () => {
  markSetupSeen()
})

/** Claude returns the page to open; GitHub, the code to enter there. */
export const startSignIn = createServerFn({ method: 'POST' })
  .validator((d: { to: signin.Provider }) => d)
  .handler(async ({ data }) =>
    data.to === 'claude' ? { url: await signin.startClaude(), code: null } : { url: null, code: await signin.startGithub() },
  )

export const finishClaudeSignIn = createServerFn({ method: 'POST' })
  .validator((d: { code: string }) => d)
  .handler(async ({ data }) => {
    if (!data.code.trim()) throw new Error('Paste the code from the Claude page')
    await signin.finishClaude(data.code)
  })

export const getProjects = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ProjectSummary[]> => {
    startLifecycle()
    const waiting = new Map<string, number>()
    for (const t of tasks.all()) {
      if (STAGE[t.stage].yours || agent.asking(t.id)) waiting.set(t.projectId, (waiting.get(t.projectId) ?? 0) + 1)
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
        // A cloud machine without a domain has no address to open it at yet.
        const hidden = isCloud() && !publicUrl
        const url = publicUrl && (view.url || isUp(view.status)) ? publicUrl : hidden ? null : view.url
        // Until its certificate exists the browser would only show "connection reset": say so instead.
        const preview = local && publicUrl && host ? { url: publicUrl, embeddable: true, ready: certs.ready(host) } : hidden ? null : local
        return { id: s.id, name: s.name, command: s.command, ...view, url, qr, preview, needsDomain: hidden && !!local }
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
      cloud: isCloud(),
      path: displayPath(project.path),
      git: await gitStatusFor(project.path),
      services,
      logService,
      logs: logService ? pm.logs(key(project.id, logService)) : [],
      // A task Claude is asking permission on waits on you too.
      tasks: tasks.list(project.id).map((t) => ({ ...t, asking: agent.asking(t.id) ?? undefined })),
    }
  })

export const listFolders = createServerFn({ method: 'GET' })
  .validator((d: { input: string }) => d)
  .handler(async ({ data }) => suggestFolders(data.input))

/** Where the branch stands; also checks GitHub now and then, in the background. */
async function gitStatusFor(dir: string): Promise<ProjectState['git']> {
  const s = await git.status(dir)
  if (!s) return null
  git.fetchSoon(dir)
  return { branch: s.branch, ahead: s.ahead, behind: s.behind, changed: s.changed, upstream: !!s.upstream }
}

/** Commit what changed (named after the tasks you finished), pull, push: when you ask, never by itself. */
export const syncProject = createServerFn({ method: 'POST' })
  .validator((d: { projectId: string }) => d)
  .handler(async ({ data }): Promise<{ pushed: number; pulled: number; newBranch: boolean } | { conflict: string[] }> => {
    const project = requireProject(data.projectId)
    const list = tasks.list(project.id)
    if (workflow.editing(project.id) || list.some((t) => t.stage === 'doing')) {
      throw new Error('Claude is still working here. Sync once it’s done.')
    }
    const finished = list.filter((t) => (t.stage === 'check' || t.stage === 'done') && t.changedFiles?.length && !t.syncedAt)
    const message =
      finished.length === 1
        ? finished[0].title
        : finished.length
          ? `${finished.length} changes from Pitwall\n\n${finished.map((t) => `- ${t.title}`).join('\n')}`
          : 'Changes from Pitwall'
    try {
      const r = await git.sync(project.path, message)
      for (const t of finished) tasks.update(t.id, { syncedAt: Date.now() })
      return r
    } catch (e) {
      if (!(e instanceof git.SyncConflict)) throw e
      const branch = (await git.status(project.path))?.branch ?? 'your branch'
      // Claude can untangle it; you decide when.
      tasks.add({
        projectId: project.id,
        title: `Merge GitHub's changes into ${branch}`,
        detail: `Sync stopped: GitHub has changes to the same lines as the commit here, in:\n${e.files.map((f) => `- ${f}`).join('\n')}\n\nPull from GitHub with rebase, resolve the conflicts keeping both sides' intent, and finish the rebase. Don't push; the person will press Sync.`,
        source: 'manual',
        sourceLabel: 'Sync',
      })
      return { conflict: e.files }
    }
  })

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
  // allowEmpty: a repo with nothing to run still opens, as a project with no services yet.
  .validator((d: { path: string; allowEmpty?: boolean }) => d)
  .handler(async ({ data }): Promise<OpenResult> => {
    const repo = gitUrl(data.path)
    const dir = repo ? await cloneInto(repo) : requireFolder(data.path)
    const existing = loadConfig().find((p) => p.path === dir)
    if (existing) return { status: 'opened', id: existing.id, existing: true }

    const scan = scanFolder(dir)
    const services = scan.services.filter((s) => s.enabled)
    if (!services.length && !data.allowEmpty) {
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
      asking: agent.asking(task.id),
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
/** Your answer to what Claude asked permission for. */
export const answerTask = createServerFn({ method: 'POST' })
  .validator((d: { id: string; decision: agent.Answer }) => d)
  .handler(async ({ data }) => {
    agent.answer(data.id, data.decision)
  })

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
