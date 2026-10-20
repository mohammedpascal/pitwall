import { spawn, type ChildProcess } from 'node:child_process'
import os from 'node:os'
import { MODELS } from '#/lib/models'
import * as agent from './agent'
import { killTree } from './processes'
import type { Task } from './types'

/**
 * Remote Control on a task's Claude conversation, or on the machine itself: the interactive `claude`
 * runs here with no window, and you drive it from claude.ai or the Claude app.
 * It needs a terminal, so it runs inside `script`, which gives it one. Its stdin
 * is /dev/null: macOS `script` refuses the socket Node uses for a pipe.
 */

interface Remote {
  child: ChildProcess
  url: string | null
  startedAt: number
}

// On globalThis, like agent.ts, so a hot reload doesn't lose a running session.
const store = globalThis as unknown as { __pitwallRemotes?: Map<string, Remote>; __pitwallRemoteExit?: boolean }
const remotes = (store.__pitwallRemotes ??= new Map<string, Remote>())

// Its own process group, so `claude` goes too, not just `script`; and it goes when Pitwall does.
if (!store.__pitwallRemoteExit) {
  store.__pitwallRemoteExit = true
  process.on('exit', () => {
    for (const r of remotes.values()) killTree(r.child, 'SIGTERM')
  })
}

const CONNECT_MS = 30_000

/** The terminal UI redraws in pieces, so the link's text can't be read whole; its session id can. */
const SESSION = /session_[A-Za-z0-9]{16,}/

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g

export function get(taskId: string) {
  const r = remotes.get(taskId)
  return r ? { url: r.url, startedAt: r.startedAt } : null
}

export const isOn = (taskId: string) => remotes.has(taskId)

export function stop(taskId: string) {
  const r = remotes.get(taskId)
  if (r) killTree(r.child, 'SIGTERM')
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/** Starts it and resolves with the claude.ai link once it's connected. */
export function start(task: Task, cwd: string): Promise<string> {
  if (!task.sessionId) throw new Error('Claude hasn’t worked on this task yet')
  if (agent.isRunning(task.id)) throw new Error('Claude is still working on this task')
  const cmd = ['claude', '--resume', task.sessionId, '--remote-control', task.title.slice(0, 60), '--permission-mode', 'default']
  const model = MODELS[task.model ?? 'default'].flag
  if (model) cmd.push('--model', model)
  return launch(task.id, cmd, cwd, (text) => agent.note(task.id, text, 'ok'))
}

/** The machine's own session: a fresh `claude` in the projects folder, one per Pitwall. */
const MACHINE = 'machine'

export const getMachine = () => get(MACHINE)

export const stopMachine = () => stop(MACHINE)

export function startMachine(cwd: string): Promise<string> {
  const cmd = ['claude', '--remote-control', `Pitwall on ${os.hostname()}`.slice(0, 60), '--permission-mode', 'default']
  return launch(MACHINE, cmd, cwd, () => {})
}

function launch(key: string, cmd: string[], cwd: string, note: (text: string) => void): Promise<string> {
  const running = remotes.get(key)
  if (running?.url) return Promise.resolve(running.url)
  if (running) throw new Error('Remote control is still connecting')

  // BSD script (macOS) takes the command as arguments; util-linux wants one string.
  const args =
    process.platform === 'darwin' ? ['-q', '/dev/null', ...cmd] : ['-qfc', cmd.map(quote).join(' '), '/dev/null']
  const child = spawn('script', args, {
    cwd,
    env: agent.childEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  const r: Remote = { child, url: null, startedAt: Date.now() }
  remotes.set(key, r)
  note('Starting remote control…')

  return new Promise((resolve, reject) => {
    let seen = ''
    const timer = setTimeout(() => {
      const last = seen.replace(ANSI, '').split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean).at(-1)
      reject(
        new Error(
          `Remote control didn’t connect. ${last ? `Claude said: ${last.slice(0, 160)}. ` : ''}If this folder is new to Claude, run \`claude\` in it once.`,
        ),
      )
      killTree(child, 'SIGTERM')
    }, CONNECT_MS)

    const onData = (chunk: Buffer) => {
      if (r.url) return
      seen = (seen + chunk.toString('utf8')).slice(-20_000)
      const id = SESSION.exec(seen)?.[0]
      if (!id) return
      r.url = `https://claude.ai/code/${id}`
      clearTimeout(timer)
      note(`Remote control is on: ${r.url}`)
      resolve(r.url)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    child.on('error', (e) => {
      clearTimeout(timer)
      remotes.delete(key)
      reject(e)
    })
    child.on('close', () => {
      clearTimeout(timer)
      if (remotes.get(key) === r) remotes.delete(key)
      if (r.url) note('Remote control ended.')
      else reject(new Error('Remote control stopped before it connected'))
    })
  })
}
