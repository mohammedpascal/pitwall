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
  /** For web apps: the page to show inside Pitwall, while running. */
  preview: { url: string; embeddable: boolean } | null
}

export type TaskSource = 'manual' | 'terminal' | 'console' | 'email'
export type TaskStatus = 'open' | 'done'

/**
 * Where a task is in its life. Claude works on the -ing stages; the others wait
 * on you (ready, planned, check) or are finished (done, dismissed).
 */
export type TaskStage =
  | 'new'
  | 'understanding'
  | 'ready'
  | 'planning'
  | 'planned'
  | 'doing'
  | 'check'
  | 'done'
  | 'dismissed'

export type TaskKind = 'bug' | 'change' | 'question'

/** A file added to a task (a screenshot, a log, a spec). */
export interface Attachment {
  name: string
  /** Stored file name, under .pitwall/attachments/<taskId>/. */
  file: string
  type: string
  size: number
}

/** A file on its way from the browser, base64-encoded. */
export interface AttachmentUpload {
  name: string
  type: string
  data: string
}

export interface PlanVersion {
  v: number
  at: number
  /** What you asked for when requesting this version. */
  note?: string
}

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
  stage: TaskStage
  /** A follow-up starts from a copy of this task's conversation. */
  parentId?: string
  attachments?: Attachment[]
  kind?: TaskKind
  /** Claude's understanding of the task, one paragraph. */
  summary?: string
  /** The task as it arrived, before Claude rewrote the title. */
  original?: string
  /** Why it was closed without work (duplicate, not a bug). */
  closedReason?: string
  /** One Claude conversation per task, carried across every step. */
  sessionId?: string
  plans?: PlanVersion[]
  changedFiles?: string[]
  /** When Claude finished the work; a crash fix is proven by a clean run after it. */
  fixedAt?: number
  /** The last step that failed, shown on the task. */
  error?: string
}

/** A task opened in the main panel. */
export interface TaskDetail {
  task: Task
  log: LogLine[]
  /** The HTML of the plan version asked for, or the latest. */
  plan: { v: number; html: string } | null
  working: boolean
  parent: { id: string; title: string } | null
  followUps: { id: string; title: string; stage: TaskStage }[]
}

export interface ProjectSummary {
  id: string
  name: string
  running: number
  /** Tasks waiting on you: ready to plan, plan ready, or done and to be checked. */
  needsYou: number
}

export interface ProjectState {
  id: string
  name: string
  /** Running on a cloud machine, behind a login. */
  cloud: boolean
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
