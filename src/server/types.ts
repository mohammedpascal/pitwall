// Shared between server and browser — types only, no Node imports.

export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'error'
export type LogLevel = 'info' | 'warn' | 'err' | 'ok'

export interface LogLine {
  seq: number
  t: number
  text: string
  level: LogLevel
}

export interface ServiceView {
  id: string
  name: string
  command: string
  cwdLabel: string
  status: ServiceStatus
  exitCode: number | null
  url: string | null
  startedAt: number | null
  lastSeq: number
}

export type TaskSource = 'manual' | 'terminal' | 'console' | 'email'
export type TaskStatus = 'new' | 'approved' | 'rejected'

export interface Task {
  id: string
  projectId: string
  title: string
  detail?: string
  source: TaskSource
  sourceLabel: string
  createdAt: number
  status: TaskStatus
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
  configSource: 'local' | 'example'
}

/** A service the folder scan proposes; the person confirms or edits it. */
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

export interface NewProjectInput {
  id: string
  name: string
  path: string
  services: { id: string; name: string; command: string; cwd: string }[]
}

export interface EditableProject extends NewProjectInput {
  /** Ids of services running right now. */
  running: string[]
  taskCount: number
  configSource: 'local' | 'example'
}
