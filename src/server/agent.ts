import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import type { LogLevel, LogLine } from './types'

/**
 * Runs Claude Code (`claude -p`) on a task, in the project's folder.
 * Each task keeps one conversation (session) across its steps, and one log
 * that the task view shows live.
 */

export type AgentMode = 'read' | 'edit'

/** A permission Claude is waiting on, until you answer it in Pitwall. */
interface Question {
  requestId: string
  tool: string
  input: Record<string, unknown>
  /** The rules Claude Code proposes for "always allow" (it saves them itself). */
  suggestions: unknown[]
  summary: string
}

interface Job {
  child: ChildProcess | null
  log: LogLine[]
  seq: number
  running: boolean
  asking: Question | null
}

const MAX_LOG = 600

// On globalThis, like processes.ts, so jobs survive dev-server hot reloads.
const store = globalThis as unknown as { __pitwallJobs?: Map<string, Job> }
const jobs = (store.__pitwallJobs ??= new Map<string, Job>())

function job(taskId: string) {
  let j = jobs.get(taskId)
  if (!j) {
    j = { child: null, log: [], seq: 0, running: false, asking: null }
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

/** What Claude is waiting for you to allow, if anything. */
export function asking(taskId: string) {
  const q = jobs.get(taskId)?.asking
  return q ? { tool: q.tool, summary: q.summary } : null
}

export type Answer = 'allow' | 'always' | 'deny'

/** Answers Claude's question; "always" saves Claude Code's own rule, so it isn't asked again in this project. */
export function answer(taskId: string, decision: Answer) {
  const j = jobs.get(taskId)
  const q = j?.asking
  if (!j || !q || !j.child?.stdin?.writable) throw new AgentError('Claude isn’t waiting for an answer')
  const response =
    decision === 'deny'
      ? { behavior: 'deny', message: 'The user denied this in Pitwall.' }
      : { behavior: 'allow', updatedInput: q.input, ...(decision === 'always' ? { updatedPermissions: q.suggestions } : {}) }
  j.child.stdin.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: q.requestId, response } }) + '\n')
  j.asking = null
  push(j, decision === 'deny' ? 'Denied' : decision === 'always' ? 'Always allowed in this project' : 'Allowed', decision === 'deny' ? 'err' : 'ok')
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** One readable line per tool call: "Read src/app.tsx", "$ npm test". */
function describeTool(name: string, input: Record<string, unknown>, cwd: string) {
  const file = typeof input.file_path === 'string' ? path.relative(cwd, input.file_path) || input.file_path : null
  if (name === 'Bash' && typeof input.command === 'string') return `$ ${input.command.split('\n')[0]}`
  if (typeof input.url === 'string') return `${name} ${input.url}`
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
}): Promise<{ sessionId: string; output: unknown; text: string; changedFiles: string[]; denials: string[] }> {
  const j = job(opts.taskId)
  if (j.running) throw new AgentError('Claude is already working on this task')

  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    // Anything that needs permission is asked here, and you answer it in Pitwall.
    '--permission-prompt-tool=stdio',
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
    const denials: string[] = []
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
      if (m.type === 'control_request') {
        const r = m.request ?? {}
        if (r.subtype === 'can_use_tool') {
          const input = (r.input ?? {}) as Record<string, unknown>
          const full = r.tool_name === 'Bash' && typeof input.command === 'string' ? `$ ${input.command}` : null
          const summary = full ?? describeTool(r.tool_name, input, opts.cwd) ?? r.title ?? r.description ?? r.tool_name
          j.asking = { requestId: m.request_id, tool: r.tool_name, input, suggestions: r.permission_suggestions ?? [], summary }
          push(j, `Waiting for you: ${summary}`, 'warn')
        } else {
          // Nothing else needs an answer from Pitwall; reply so Claude never waits on it.
          child.stdin?.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: {} } }) + '\n')
        }
        return
      }
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
          denials.push(d.tool_name)
        }
        // The answer is in; with stream-json input, Claude waits for more until stdin closes.
        child.stdin?.end()
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
    // Written to after it may have closed (a late answer): never let that crash Pitwall.
    child.stdin?.on('error', () => {})
    child.stdin?.write(JSON.stringify({ type: 'user', message: { role: 'user', content: opts.prompt } }) + '\n')

    child.on('error', (e: NodeJS.ErrnoException) => {
      j.running = false
      j.asking = null
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
      j.asking = null
      if (signal) return reject(new AgentError('Stopped'))
      if (failure) return reject(new AgentError(failure))
      if (code !== 0) return reject(new AgentError(stderr.trim().split('\n').at(-1) || `Claude exited with code ${code}`))
      resolve({ sessionId, output, text, changedFiles: [...changed], denials })
    })
  })
}
