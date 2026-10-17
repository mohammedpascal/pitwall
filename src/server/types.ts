// Shared between server and browser — types only, no Node imports.

export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'error'
export type LogLevel = 'info' | 'warn' | 'err' | 'ok'

export interface LogLine {
  seq: number
  t: number
  text: string
  level: LogLevel
}

/** One service as written in pitwall.config.json. */
export interface ServiceConfig {
  id: string
  name: string
  command: string
  /** Folder to run in, relative to the project's path. Defaults to the project folder. */
  cwd?: string
}

/** One project as written in pitwall.config.json. */
export interface ProjectConfig {
  id: string
  name: string
  path: string
  services: ServiceConfig[]
  /** Suggestions the person dismissed ("cwd|command"). */
  ignore?: string[]
}

export interface ServiceView {
  id: string
  name: string
  command: string
  status: ServiceStatus
  exitCode: number | null
  url: string | null
  startedAt: number | null
  lastSeq: number
  /** For Expo apps: the link to scan with a phone, while running. */
  qr: { url: string; hint: string } | null
}

export type TaskSource = 'manual' | 'terminal' | 'console' | 'email'
export type TaskStatus = 'open' | 'done'

export interface Task {
  id: string
  projectId: string
  title: string
  detail?: string
  source: TaskSource
  sourceLabel: string
  createdAt: number
  status: TaskStatus
  /** Crash tasks: how many times the same error happened, and when last. */
  count?: number
  lastSeenAt?: number
  signature?: string
  serviceId?: string
}

export interface ProjectSummary {
  id: string
  name: string
  running: number
}

export interface ProjectState {
  id: string
  name: string
  path: string
  services: ServiceView[]
  logService: string | null
  logs: LogLine[]
  tasks: Task[]
}

/** A service the folder scan proposes. */
export interface DetectedService {
  id: string
  name: string
  command: string
  /** Relative to the project folder; '' means the project folder itself. */
  cwd: string
  kind: string
  enabled: boolean
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export interface ScanResult {
  path: string
  displayPath: string
  suggestedId: string
  suggestedName: string
  packageManager: PackageManager
  portless: boolean
  services: DetectedService[]
  notes: string[]
}

export type OpenResult =
  | { status: 'opened'; id: string; existing: boolean }
  /** Nothing runnable found: the person adds the first service by hand. */
  | { status: 'empty'; path: string; displayPath: string; name: string }

/** Everything needed to undo removing a project. */
export interface RemovedProject {
  project: ProjectConfig
  index: number
  tasks: Task[]
}

/** Everything needed to undo removing a service. */
export interface RemovedService {
  projectId: string
  service: ServiceConfig
  index: number
}
