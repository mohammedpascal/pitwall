import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import type { LogLevel, LogLine } from './types'

/**
 * Runs Claude Code (`claude -p`) on a task, in the project's folder.
 * Each task keeps one conversation (session) across its steps, and one log
 * that the task view shows live.
 */

export type AgentMode = 'read' | 'edit'

interface Job {
  child: ChildProcess | null
  log: LogLine[]
  seq: number
  running: boolean
}

const MAX_LOG = 600

// On globalThis, like processes.ts, so jobs survive dev-server hot reloads.
const store = globalThis as unknown as { __pitwallJobs?: Map<string, Job> }
const jobs = (store.__pitwallJobs ??= new Map<string, Job>())

function job(taskId: string) {
  let j = jobs.get(taskId)
  if (!j) {
    j = { child: null, log: [], seq: 0, running: false }
    jobs.set(taskId, j)
  }
  return j
}

function push(j: Job, text: string, level: LogLevel = 'info') {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    j.log.push({ seq: ++j.seq, t: Date.now(), text: line, level })
  }
  if (j.log.length > MAX_LOG) j.log.splice(0, j.log.length - MAX_LOG)
}

export function log(taskId: string) {
  return jobs.get(taskId)?.log ?? []
}

export function isRunning(taskId: string) {
  return jobs.get(taskId)?.running ?? false
}

export function note(taskId: string, text: string, level: LogLevel = 'info') {
  push(job(taskId), text, level)
}

export function stop(taskId: string) {
  const j = jobs.get(taskId)
  if (j?.child && j.running) j.child.kill('SIGTERM')
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** One readable line per tool call: "Read src/app.tsx", "$ npm test". */
function describeTool(name: string, input: Record<string, unknown>, cwd: string) {
  const file = typeof input.file_path === 'string' ? path.relative(cwd, input.file_path) || input.file_path : null
  if (name === 'Bash' && typeof input.command === 'string') return `$ ${input.command.split('\n')[0]}`
  if (file) return `${name} ${file}`
  if (typeof input.pattern === 'string') return `${name} ${input.pattern}`
  if (name === 'StructuredOutput') return null
  return name
}

export class AgentError extends Error {}

/** Pitwall may itself run inside a Claude Code session; a `claude` it starts is its own. */
export function childEnv() {
  const env = { ...process.env }
  for (const k of Object.keys(env)) {
    if (
      k === 'CLAUDECODE' ||
      k.startsWith('CLAUDE_CODE_') ||
      k === 'PORT' ||
      k === 'HOST' ||
      k === 'NODE_ENV' ||
      k.startsWith('PORTLESS_')
    )
      delete env[k]
  }
  return env
}

export async function runClaude(opts: {
  taskId: string
  cwd: string
  prompt: string
  sessionId?: string
  mode: AgentMode
  /** Ask for an answer in this JSON shape. */
  schema?: object
  /** Folders outside the project Claude may read, e.g. the task's attachments. */
  addDirs?: string[]
  /** Continue a copy of the session, leaving the original as it was. */
  fork?: boolean
}): Promise<{ sessionId: string; output: unknown; text: string; changedFiles: string[] }> {
  const j = job(opts.taskId)
  if (j.running) throw new AgentError('Claude is already working on this task')

  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    // Understanding and planning only read the project; only "Do it" edits it.
    '--permission-mode',
    opts.mode === 'edit' ? 'acceptEdits' : 'plan',
  ]
  if (opts.sessionId) args.push('--resume', opts.sessionId)
  if (opts.sessionId && opts.fork) args.push('--fork-session')
  if (opts.schema) args.push('--json-schema', JSON.stringify(opts.schema))
  for (const d of opts.addDirs ?? []) args.push('--add-dir', d)

  const env = childEnv()

  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn('claude', args, { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch {
      reject(new AgentError('Claude Code isn’t installed. Install it from claude.com/code.'))
      return
    }
    j.child = child
    j.running = true

    let sessionId = opts.sessionId ?? ''
    let output: unknown = null
    let text = ''
    let failure: string | null = null
    const changed = new Set<string>()
    let partial = ''
    let stderr = ''

    const handle = (line: string) => {
      let m: Record<string, any>
      try {
        m = JSON.parse(line)
      } catch {
        return
      }
      if (m.session_id) sessionId = m.session_id
      if (m.type === 'assistant') {
        for (const c of m.message?.content ?? []) {
          if (c.type === 'text' && c.text) push(j, c.text)
          if (c.type === 'tool_use') {
            const input = (c.input ?? {}) as Record<string, unknown>
            const desc = describeTool(c.name, input, opts.cwd)
            if (desc) push(j, desc, 'warn')
            if (EDIT_TOOLS.has(c.name) && typeof input.file_path === 'string') {
              changed.add(path.relative(opts.cwd, input.file_path) || input.file_path)
            }
          }
        }
      } else if (m.type === 'result') {
        output = m.structured_output ?? null
        text = typeof m.result === 'string' ? m.result : ''
        if (m.is_error) failure = text || 'Claude stopped with an error'
        for (const d of m.permission_denials ?? []) {
          push(j, `Not allowed: ${d.tool_name}`, 'err')
        }
      }
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      partial += chunk
      const lines = partial.split('\n')
      partial = lines.pop() ?? ''
      lines.forEach(handle)
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000)
    })
    child.stdin?.end(opts.prompt)

    child.on('error', (e: NodeJS.ErrnoException) => {
      j.running = false
      reject(
        new AgentError(
          e.code === 'ENOENT' ? 'Claude Code isn’t installed. Install it from claude.com/code.' : e.message,
        ),
      )
    })
    child.on('close', (code, signal) => {
      if (partial) handle(partial)
      j.running = false
      j.child = null
      if (signal) return reject(new AgentError('Stopped'))
      if (failure) return reject(new AgentError(failure))
      if (code !== 0) return reject(new AgentError(stderr.trim().split('\n').at(-1) || `Claude exited with code ${code}`))
      resolve({ sessionId, output, text, changedFiles: [...changed] })
    })
  })
}
