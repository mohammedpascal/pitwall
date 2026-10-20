import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { childEnv } from './agent'
import { killTree } from './processes'

/**
 * Signing this machine in to Claude (for tasks) and GitHub (for git push and
 * pull requests) from the browser. Both CLIs sign in without a terminal:
 * `claude auth login` prints a link and reads the code you paste from stdin,
 * `gh auth login --web` prints a one-time code and waits until you approve it.
 */

export type Provider = 'claude' | 'github'

interface Account {
  ok: boolean
  who: string | null
}

export interface SignInStatus {
  claude: Account & { url: string | null; error: string | null }
  github: Account & { code: string | null; url: string | null; error: string | null }
}

interface Flow {
  child: ChildProcess
  output: string
  url: string | null
  code: string | null
  error: string | null
}

// On globalThis, like remote.ts, so a hot reload doesn't lose a sign-in in progress.
const store = globalThis as unknown as { __pitwallSignIn?: Map<Provider, Flow>; __pitwallSignInExit?: boolean }
const flows = (store.__pitwallSignIn ??= new Map<Provider, Flow>())

if (!store.__pitwallSignInExit) {
  store.__pitwallSignInExit = true
  process.on('exit', () => {
    for (const f of flows.values()) killTree(f.child, 'SIGTERM')
  })
}

const GIVE_UP_MS = 10 * 60_000
const DEVICE_URL = 'https://github.com/login/device'
const CLAUDE_URL = /https:\/\/\S+\/oauth\/authorize\?\S+/
const GITHUB_CODE = /one-time code: ([A-Z0-9]{4}-[A-Z0-9]{4})/

/** Never rejects: a missing command or a failure is just `ok: false`. */
function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { env: childEnv(), timeout: 15_000 }, (err, stdout) => resolve({ ok: !err, out: stdout.trim() }))
  })
}

const lastLine = (s: string) =>
  s.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean).at(-1)?.slice(0, 200) ?? null

// ── Status ──────────────────────────────────────────────────────────────────

let cached: { at: number; value: { claude: Account; github: Account } } | null = null

async function signedIn() {
  if (cached && Date.now() - cached.at < 5_000) return cached.value
  const [claude, github] = await Promise.all([
    run('claude', ['auth', 'status', '--json']).then(({ out }): Account => {
      try {
        const s = JSON.parse(out) as { loggedIn?: boolean; email?: string }
        return { ok: !!s.loggedIn, who: s.email ?? null }
      } catch {
        return { ok: false, who: null }
      }
    }),
    run('gh', ['auth', 'status', '--hostname', 'github.com']).then(async ({ ok }): Promise<Account> => {
      if (!ok) return { ok: false, who: null }
      const user = await run('gh', ['api', 'user', '--jq', '.login'])
      return { ok: true, who: user.ok ? user.out : null }
    }),
  ])
  const value = { claude, github }
  cached = { at: Date.now(), value }
  return value
}

export async function status(): Promise<SignInStatus> {
  const s = await signedIn()
  const c = flows.get('claude')
  const g = flows.get('github')
  const live = (f: Flow | undefined) => (f && f.child.exitCode === null && f.child.signalCode === null ? f : undefined)
  return {
    claude: { ...s.claude, url: s.claude.ok ? null : (live(c)?.url ?? null), error: s.claude.ok ? null : (c?.error ?? null) },
    github: {
      ...s.github,
      code: s.github.ok ? null : (live(g)?.code ?? null),
      url: !s.github.ok && live(g)?.code ? DEVICE_URL : null,
      error: s.github.ok ? null : (g?.error ?? null),
    },
  }
}

// ── Signing out ─────────────────────────────────────────────────────────────

/** Logs this machine's claude or gh out, ending a sign-in still in progress too. */
export async function signOut(p: Provider) {
  const flow = flows.get(p)
  if (flow) killTree(flow.child, 'SIGTERM')
  flows.delete(p)
  const { ok, out } = await (p === 'claude'
    ? run('claude', ['auth', 'logout'])
    : run('gh', ['auth', 'logout', '--hostname', 'github.com']))
  cached = null
  if (!ok) throw new Error(lastLine(out) ?? `Couldn’t sign out of ${p === 'claude' ? 'Claude' : 'GitHub'}`)
}

// ── Signing in ──────────────────────────────────────────────────────────────

function begin(p: Provider, cmd: string, args: string[], env: NodeJS.ProcessEnv = {}): Flow {
  const old = flows.get(p)
  if (old) killTree(old.child, 'SIGTERM')
  const child = spawn(cmd, args, {
    env: { ...childEnv(), ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  const flow: Flow = { child, output: '', url: null, code: null, error: null }
  flows.set(p, flow)
  const onData = (chunk: Buffer) => {
    flow.output = (flow.output + chunk.toString('utf8')).slice(-20_000)
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  const timer = setTimeout(() => killTree(child, 'SIGTERM'), GIVE_UP_MS)
  child.on('error', (e) => {
    flow.error = e.message
  })
  child.on('close', () => {
    clearTimeout(timer)
    cached = null
  })
  return flow
}

/** Resolves once `test` finds what it needs in the output, or rejects if the command ends first. */
function waitFor<T>(flow: Flow, test: (out: string) => T | null, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const found = test(flow.output)
      if (found) {
        done()
        resolve(found)
      }
    }
    const fail = () => {
      done()
      reject(new Error(flow.error ?? `Couldn’t get ${what}. ${lastLine(flow.output) ?? ''}`.trim()))
    }
    const timer = setTimeout(fail, 30_000)
    const done = () => {
      clearTimeout(timer)
      flow.child.stdout?.off('data', check)
      flow.child.stderr?.off('data', check)
      flow.child.off('close', fail)
    }
    flow.child.stdout?.on('data', check)
    flow.child.stderr?.on('data', check)
    flow.child.on('close', fail)
    check()
  })
}

/** Starts Claude's sign-in and returns the page to open. */
export async function startClaude(): Promise<string> {
  const flow = begin('claude', 'claude', ['auth', 'login'], { BROWSER: 'true' })
  flow.url = await waitFor(flow, (out) => CLAUDE_URL.exec(out)?.[0] ?? null, 'the sign-in link')
  return flow.url
}

/** Hands Claude the code from that page, and resolves once it's signed in. */
export function finishClaude(code: string): Promise<void> {
  const flow = flows.get('claude')
  if (!flow || flow.child.exitCode !== null) throw new Error('Start signing in to Claude again')
  const before = flow.output.length
  flow.child.stdin?.write(`${code.trim()}\n`)
  return new Promise((resolve, reject) => {
    // A wrong code leaves it waiting for another one, so you can paste again.
    const onData = () => {
      const said = flow.output.slice(before)
      if (!/invalid code/i.test(said)) return
      done()
      reject(new Error('That code didn’t work. Copy the whole code from the Claude page and paste it again.'))
    }
    const onClose = (exit: number | null) => {
      done()
      cached = null
      flows.delete('claude')
      if (exit === 0) resolve()
      else reject(new Error(lastLine(flow.output.slice(before)) ?? 'Claude didn’t accept that code'))
    }
    const done = () => {
      flow.child.stdout?.off('data', onData)
      flow.child.stderr?.off('data', onData)
      flow.child.off('close', onClose)
    }
    flow.child.stdout?.on('data', onData)
    flow.child.stderr?.on('data', onData)
    flow.child.on('close', onClose)
  })
}

/** Starts GitHub's sign-in and returns the code to enter; it finishes on its own once approved. */
export async function startGithub(): Promise<string> {
  const flow = begin('github', 'gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'], {
    GH_PROMPT_DISABLED: '1',
    BROWSER: 'true',
  })
  flow.child.stdin?.end()
  flow.child.on('close', (exit) => {
    if (exit !== 0) {
      flow.error ??= lastLine(flow.output)
      return
    }
    flows.delete('github')
    void setUpGit()
  })
  flow.code = await waitFor(flow, (out) => GITHUB_CODE.exec(out)?.[1] ?? null, 'a code from GitHub')
  return flow.code
}

/** `git push` goes through the GitHub sign-in, and commits get the account's name and email. */
async function setUpGit() {
  await run('gh', ['auth', 'setup-git'])
  const name = await run('git', ['config', '--global', 'user.name'])
  if (name.ok && name.out) return
  const user = await run('gh', ['api', 'user', '--jq', '[.name // .login, .email // "\\(.id)+\\(.login)@users.noreply.github.com"] | @tsv'])
  const [who, email] = user.out.split('\t')
  if (!user.ok || !who || !email) return
  await run('git', ['config', '--global', 'user.name', who])
  await run('git', ['config', '--global', 'user.email', email])
}
