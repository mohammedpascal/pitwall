import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { LogLevel, LogLine, ServiceStatus } from './types'

type Stream = 'out' | 'err' | 'sys'

interface Proc {
  status: ServiceStatus
  child: ChildProcess | null
  logs: LogLine[]
  seq: number
  startedAt: number | null
  exitCode: number | null
  /** When the last run ended, and so whether a clean exit came after a fix. */
  endedAt: number | null
  url: string | null
  stopping: boolean
  partial: Record<'out' | 'err', string>
}

const MAX_LOGS = 1000
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

// Kept on globalThis so running services survive dev-server hot reloads.
const store = globalThis as unknown as {
  __pitwallProcs?: Map<string, Proc>
  __pitwallExitHook?: boolean
  __pitwallOnCrash?: (key: string) => void
}
const procs = (store.__pitwallProcs ??= new Map<string, Proc>())

/** Called when a service exits with an error (not when it's stopped). */
export function onCrash(fn: (key: string) => void) {
  store.__pitwallOnCrash = fn
}

// Services you left running are remembered, so reopening Pitwall starts them again.
const RUNNING_FILE = path.join(process.cwd(), '.pitwall', 'running.json')

export function remembered(): string[] {
  try {
    return JSON.parse(fs.readFileSync(RUNNING_FILE, 'utf8')) as string[]
  } catch {
    return []
  }
}

function remember(key: string, on: boolean) {
  const keys = new Set(remembered())
  if (on === keys.has(key)) return
  if (on) keys.add(key)
  else keys.delete(key)
  fs.mkdirSync(path.dirname(RUNNING_FILE), { recursive: true })
  fs.writeFileSync(RUNNING_FILE, JSON.stringify([...keys], null, 2))
}

function get(key: string): Proc {
  let p = procs.get(key)
  if (!p) {
    p = {
      status: 'stopped',
      child: null,
      logs: [],
      seq: 0,
      startedAt: null,
      exitCode: null,
      endedAt: null,
      url: null,
      stopping: false,
      partial: { out: '', err: '' },
    }
    procs.set(key, p)
  }
  return p
}

function classify(text: string, stream: Stream): LogLevel {
  if (
    /(error|exception)\b|\b(failed|fatal|EADDRINUSE)\b|ERR!/i.test(text) ||
    (stream === 'err' && /^\s+at\s/.test(text))
  )
    return 'err'
  if (/\bwarn(ing)?\b/i.test(text)) return 'warn'
  if (/\b(ready|listening|started|compiled successfully)\b|Local:/i.test(text))
    return 'ok'
  return 'info'
}

const LOCAL_HOST =
  /^(localhost|.+\.localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i

/**
 * The first URL in a line that points at this machine or the local network.
 * Docs links such as https://expo.fyi/… are skipped.
 */
export function localUrl(text: string): string | null {
  for (const m of text.matchAll(/https?:\/\/[^\s'"<>)]+/g)) {
    const raw = m[0].replace(/[.,;]$/, '')
    try {
      if (LOCAL_HOST.test(new URL(raw).hostname)) return raw
    } catch {
      /* not a URL after all */
    }
  }
  return null
}

function push(p: Proc, raw: string, stream: Stream, level?: LogLevel) {
  const text = raw.replace(ANSI, '').replace(/\r/g, '')
  if (!text.trim()) return
  const lvl = level ?? classify(text, stream)
  p.logs.push({ seq: ++p.seq, t: Date.now(), text, level: lvl })
  if (p.logs.length > MAX_LOGS) p.logs.splice(0, p.logs.length - MAX_LOGS)
  if (stream !== 'sys' && !p.url) p.url = localUrl(text)
  if (p.status === 'starting' && (p.url || lvl === 'ok')) p.status = 'running'
}

function feed(p: Proc, chunk: Buffer, stream: 'out' | 'err') {
  const lines = (p.partial[stream] + chunk.toString('utf8')).split('\n')
  p.partial[stream] = lines.pop() ?? ''
  for (const line of lines) push(p, line, stream)
}

function flush(p: Proc) {
  for (const s of ['out', 'err'] as const) {
    if (p.partial[s]) push(p, p.partial[s], s)
    p.partial[s] = ''
  }
}

export function killTree(child: ChildProcess, signal: NodeJS.Signals) {
  try {
    // Services run in their own process group, so npm/portless children die too.
    if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      /* already gone */
    }
  }
}

/**
 * Pitwall itself usually runs under portless, which hands it PORT (and HOST).
 * Services must not inherit those, or they all try to bind Pitwall's port.
 */
function serviceEnv() {
  const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '0' }
  for (const k of Object.keys(env)) {
    if (k === 'PORT' || k === 'HOST' || k.startsWith('PORTLESS_')) delete env[k]
  }
  return env
}

export function start(key: string, command: string, cwd: string, extraEnv: Record<string, string> = {}) {
  const p = get(key)
  if (p.child) return
  p.stopping = false
  p.exitCode = null
  p.url = null

  if (!fs.existsSync(cwd)) {
    p.status = 'error'
    push(p, `Folder not found: ${cwd}`, 'sys', 'err')
    return
  }

  p.status = 'starting'
  p.startedAt = Date.now()
  remember(key, true)
  push(p, `$ ${command}`, 'sys', 'info')

  const child = spawn(command, {
    cwd,
    shell: true,
    detached: process.platform !== 'win32',
    env: { ...serviceEnv(), ...extraEnv },
  })
  p.child = child

  child.stdout?.on('data', (b: Buffer) => feed(p, b, 'out'))
  child.stderr?.on('data', (b: Buffer) => feed(p, b, 'err'))
  child.on('error', (e) => {
    push(p, `Could not start: ${e.message}`, 'sys', 'err')
    p.status = 'error'
    p.child = null
    p.startedAt = null
  })
  child.on('exit', (code, signal) => {
    if (p.child !== child) return
    flush(p)
    p.child = null
    p.startedAt = null
    p.endedAt = Date.now()
    if (p.stopping) {
      p.status = 'stopped'
      push(p, 'Stopped', 'sys', 'info')
    } else if (code === 0) {
      p.status = 'stopped'
      p.exitCode = 0
      push(p, 'Exited', 'sys', 'info')
      remember(key, false)
    } else {
      p.status = 'error'
      p.exitCode = code
      push(p, `Process exited with ${code !== null ? `code ${code}` : signal}`, 'sys', 'err')
      remember(key, false)
      try {
        store.__pitwallOnCrash?.(key)
      } catch (e) {
        console.error('[pitwall] crash handler failed', e)
      }
    }
    p.stopping = false
  })

  // No "ready" line or URL after a few seconds but still alive: call it running.
  setTimeout(() => {
    if (p.child === child && p.status === 'starting') p.status = 'running'
  }, 4000)
}

export function stop(key: string) {
  remember(key, false)
  const p = procs.get(key)
  if (!p?.child) return
  const child = p.child
  p.stopping = true
  killTree(child, 'SIGTERM')
  setTimeout(() => {
    if (p.child === child) killTree(child, 'SIGKILL')
  }, 5000)
}

export function view(key: string) {
  const p = get(key)
  return {
    status: p.status,
    exitCode: p.exitCode,
    endedAt: p.endedAt,
    url: p.url,
    startedAt: p.startedAt,
    lastSeq: p.seq,
  }
}

/**
 * Command lines of everything the service started (its process group), e.g. the
 * real `expo start --dev-client --port 8082` behind `npm start`.
 */
export function groupCommands(key: string): string[] {
  const pid = procs.get(key)?.child?.pid
  if (!pid || process.platform === 'win32') return []
  try {
    return execFileSync('ps', ['-A', '-o', 'pgid=,command='], { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
      .filter((m): m is RegExpMatchArray => !!m && Number(m[1]) === pid)
      .map((m) => m[2])
  } catch {
    return []
  }
}

export function logs(key: string, limit = 400): LogLine[] {
  return get(key).logs.slice(-limit)
}

if (!store.__pitwallExitHook) {
  store.__pitwallExitHook = true
  const killAll = () => {
    for (const p of procs.values()) if (p.child) killTree(p.child, 'SIGTERM')
  }
  process.on('exit', killAll)
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      killAll()
      process.exit(0)
    })
  }
}
