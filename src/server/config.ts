import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ProjectConfig, ServiceConfig } from './types'

export type { ProjectConfig, ServiceConfig }

const ROOT = process.cwd()
const FILE = path.join(ROOT, 'pitwall.config.json')

type RawConfig = { projects?: ProjectConfig[]; domain?: string; setupSeen?: boolean; helloSeeded?: boolean } & Record<string, unknown>

export function expand(p: string, base: string = ROOT) {
  if (p === '~' || p.startsWith('~/')) return path.resolve(os.homedir(), p.slice(2))
  return path.resolve(base, p)
}

export function displayPath(p: string) {
  const home = os.homedir()
  return p.startsWith(home) ? '~' + p.slice(home.length) : p
}

/** The config as written on disk (paths not expanded). */
function readRaw(): RawConfig {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as RawConfig
  } catch {
    return { projects: [] }
  }
}

function writeRaw(config: RawConfig) {
  fs.writeFileSync(FILE, JSON.stringify(config, null, 2) + '\n')
}

function edit(fn: (projects: ProjectConfig[]) => ProjectConfig[]) {
  const config = readRaw()
  writeRaw({ ...config, projects: fn(config.projects ?? []) })
}

/**
 * Set on a cloud machine: services are served at <project>-<service>.<domain>
 * and Pitwall at pitwall.<domain>. Unset (on a laptop) everything stays local.
 */
export function configuredDomain(): string | null {
  const d = (process.env.PITWALL_DOMAIN ?? readRaw().domain ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')
  return d || null
}

/** A cloud machine, with or without a dev domain yet: the installer sets PITWALL_CLOUD. */
export const isCloud = () => process.env.PITWALL_CLOUD === '1' || !!configuredDomain()

/** The server's public address, which Pitwall answers on until it has a domain. */
export const publicIp = () => process.env.PITWALL_IP?.trim() || null

export function setDomain(domain: string) {
  writeRaw({ ...readRaw(), domain })
}

export const setupSeen = () => readRaw().setupSeen === true

/** Where projects go: PITWALL_PROJECTS, else ~/projects on a cloud machine and ~/src here. */
export const projectsDir = () => expand(process.env.PITWALL_PROJECTS?.trim() || (isCloud() ? '~/projects' : '~/src'))

let versionCache: string | null = null

/**
 * The running version: the VERSION file a release ships next to server.mjs (which
 * `pitwall status` reads too), else the checkout's tag, as `git describe` puts it.
 */
export function version() {
  if (versionCache) return versionCache
  const app = process.argv[1] ? path.dirname(path.resolve(process.argv[1])) : ROOT
  for (const dir of [app, ROOT]) {
    try {
      const v = fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim()
      if (v) return (versionCache = v)
    } catch {}
  }
  try {
    // "v0.11.1" on a tag, "v0.11.1-2-gabc1234" two commits past it, or just the commit without tags.
    const d = execFileSync('git', ['describe', '--tags', '--always'], { cwd: ROOT, encoding: 'utf8' }).trim()
    const past = d.match(/^(.+)-(\d+)-g[0-9a-f]+$/)
    return (versionCache = past ? `${past[1]} +${past[2]}` : d || 'dev')
  } catch {
    return (versionCache = 'unknown')
  }
}

/** The sample project is made once; removing it doesn't bring it back. */
export const helloSeeded = () => readRaw().helloSeeded === true

export function markHelloSeeded() {
  writeRaw({ ...readRaw(), helloSeeded: true })
}

export function markSetupSeen() {
  writeRaw({ ...readRaw(), setupSeen: true })
}

/** Read on every call so edits to the config show up without a restart. */
export function loadConfig() {
  return (readRaw().projects ?? []).map((p) => ({
    ...p,
    path: expand(p.path),
    services: p.services ?? [],
  }))
}

export function findProject(id: string) {
  return loadConfig().find((p) => p.id === id)
}

/** The project exactly as written in the config. */
export function rawProject(id: string) {
  return (readRaw().projects ?? []).find((p) => p.id === id)
}

export function serviceCwd(project: ProjectConfig, s: ServiceConfig) {
  return s.cwd ? expand(s.cwd, project.path) : project.path
}

export function insertProject(project: ProjectConfig, index?: number) {
  edit((projects) => {
    if (projects.some((p) => p.id === project.id)) {
      throw new Error(`A project with the id "${project.id}" already exists`)
    }
    const next = [...projects]
    next.splice(index ?? next.length, 0, project)
    return next
  })
}

export function updateProject(id: string, change: (p: ProjectConfig) => ProjectConfig) {
  edit((projects) => {
    if (!projects.some((p) => p.id === id)) throw new Error(`Unknown project: ${id}`)
    return projects.map((p) => (p.id === id ? change(p) : p))
  })
}

/** Remove a project and return it with its position, for undo. */
export function removeProject(id: string) {
  let removed: { project: ProjectConfig; index: number } | null = null
  edit((projects) => {
    const index = projects.findIndex((p) => p.id === id)
    if (index === -1) return projects
    removed = { project: projects[index], index }
    return projects.filter((p) => p.id !== id)
  })
  return removed as { project: ProjectConfig; index: number } | null
}
