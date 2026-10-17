import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface ServiceConfig {
  id: string
  name: string
  command: string
  /** Folder to run in, relative to the project's path. Defaults to the project folder. */
  cwd?: string
}

export interface ProjectConfig {
  id: string
  name: string
  path: string
  services: ServiceConfig[]
}

const ROOT = process.cwd()
const LOCAL = path.join(ROOT, 'pitwall.config.json')
const EXAMPLE = path.join(ROOT, 'pitwall.config.example.json')

export function expand(p: string, base: string = ROOT) {
  if (p === '~' || p.startsWith('~/')) return path.resolve(os.homedir(), p.slice(2))
  return path.resolve(base, p)
}

/** Read on every call so edits to the config show up without a restart. */
export function loadConfig() {
  const source = fs.existsSync(LOCAL) ? ('local' as const) : ('example' as const)
  const file = source === 'local' ? LOCAL : EXAMPLE
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    projects?: ProjectConfig[]
  }
  const projects = (raw.projects ?? []).map((p) => ({
    ...p,
    path: expand(p.path, ROOT),
    services: p.services ?? [],
  }))
  return { source, projects }
}

export function findProject(id: string) {
  return loadConfig().projects.find((p) => p.id === id)
}

export function serviceCwd(project: ProjectConfig, s: ServiceConfig) {
  return s.cwd ? expand(s.cwd, project.path) : project.path
}

export function displayPath(p: string) {
  const home = os.homedir()
  return p.startsWith(home) ? '~' + p.slice(home.length) : p
}

/** Add a project to pitwall.config.json, creating the file on first use. */
export function saveProject(project: ProjectConfig) {
  const current = fs.existsSync(LOCAL)
    ? (JSON.parse(fs.readFileSync(LOCAL, 'utf8')) as { projects?: ProjectConfig[] })
    : { projects: [] }
  const projects = current.projects ?? []
  if (projects.some((p) => p.id === project.id)) {
    throw new Error(`A project with the id "${project.id}" already exists`)
  }
  fs.writeFileSync(
    LOCAL,
    JSON.stringify({ ...current, projects: [...projects, project] }, null, 2) + '\n',
  )
}

type RawConfig = { projects?: ProjectConfig[] } & Record<string, unknown>

/** The config as written on disk (paths not expanded), from the local file or the example. */
function readRaw(): RawConfig {
  const file = fs.existsSync(LOCAL) ? LOCAL : EXAMPLE
  return JSON.parse(fs.readFileSync(file, 'utf8')) as RawConfig
}

function writeLocal(config: RawConfig) {
  fs.writeFileSync(LOCAL, JSON.stringify(config, null, 2) + '\n')
}

/** The project as written in the config, for editing. */
export function rawProject(id: string) {
  return (readRaw().projects ?? []).find((p) => p.id === id)
}

export function updateProject(id: string, next: ProjectConfig) {
  const config = readRaw()
  const projects = config.projects ?? []
  const i = projects.findIndex((p) => p.id === id)
  if (i === -1) throw new Error(`Unknown project: ${id}`)
  projects[i] = next
  writeLocal({ ...config, projects })
}

export function removeProject(id: string) {
  const config = readRaw()
  writeLocal({ ...config, projects: (config.projects ?? []).filter((p) => p.id !== id) })
}
