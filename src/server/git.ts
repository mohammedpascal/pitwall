import { execFile } from 'node:child_process'
import { childEnv } from './agent'

/**
 * Git for projects that came from a remote: where the branch stands, and one
 * Sync that commits your changes, pulls with rebase and pushes. Nothing here
 * runs on its own except a quiet `git fetch`, so "3 new on GitHub" is known.
 */

export interface GitStatus {
  branch: string | null
  upstream: string | null
  /** Commits here that aren't on the remote yet. */
  ahead: number
  /** Commits on the remote that aren't here yet (as of the last fetch). */
  behind: number
  /** Files changed, added or deleted and not committed. */
  changed: number
}

export class SyncConflict extends Error {
  constructor(public files: string[]) {
    super(`GitHub has changes to the same lines in ${files.join(', ')}`)
  }
}

function git(dir: string, args: string[], timeout = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    // No terminal to type a password into: fail with a message instead of waiting.
    const env = { ...childEnv(), GIT_TERMINAL_PROMPT: '0' }
    execFile('git', args, { cwd: dir, env, timeout, maxBuffer: 16 << 20 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout)
      const last = `${stderr}`.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
      reject(new Error(last?.replace(/^(fatal|error): /, '') || err.message))
    })
  })
}

// Whether the folder has an origin to sync with; asked at most once a minute.
const remotes = new Map<string, { has: boolean; at: number }>()

async function hasOrigin(dir: string) {
  const known = remotes.get(dir)
  if (known && Date.now() - known.at < 60_000) return known.has
  const has = await git(dir, ['remote', 'get-url', 'origin']).then(
    () => true,
    () => false,
  )
  remotes.set(dir, { has, at: Date.now() })
  return has
}

/** Null when it isn't a git repo with an origin: then there's nothing to sync. */
export async function status(dir: string): Promise<GitStatus | null> {
  if (!(await hasOrigin(dir))) return null
  let out: string
  try {
    out = await git(dir, ['status', '--porcelain=v2', '--branch'], 10_000)
  } catch {
    return null
  }
  const s: GitStatus = { branch: null, upstream: null, ahead: 0, behind: 0, changed: 0 }
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const b = line.slice(14)
      s.branch = b === '(detached)' ? null : b
    } else if (line.startsWith('# branch.upstream ')) s.upstream = line.slice(18)
    else if (line.startsWith('# branch.ab ')) {
      const [a, b] = line.slice(12).split(' ')
      s.ahead = Math.abs(Number(a)) || 0
      s.behind = Math.abs(Number(b)) || 0
    } else if (line && !line.startsWith('#')) s.changed++
  }
  return s
}

// Each folder fetches at most once a minute, in the background.
const fetched = new Map<string, number>()
const FETCH_MS = 60_000

export function fetchSoon(dir: string) {
  const last = fetched.get(dir) ?? 0
  if (Date.now() - last < FETCH_MS) return
  fetched.set(dir, Date.now())
  void hasOrigin(dir).then(async (has) => {
    if (has) await git(dir, ['fetch', '--quiet']).catch(() => {})
  })
}

/** Commit what's changed, pull GitHub's commits under it, push. Returns how many went each way. */
export async function sync(dir: string, message: string): Promise<{ pushed: number; pulled: number; newBranch: boolean }> {
  let s = await status(dir)
  if (!s) throw new Error('This project has no git remote to sync with')
  if (!s.branch) throw new Error('This project isn’t on a branch (detached HEAD). Check one out first.')

  if (s.changed) {
    await git(dir, ['add', '-A'])
    await git(dir, ['commit', '-q', '-m', message]).catch((e: Error) => {
      if (/user\.(name|email)|identity|tell me who you are/i.test(e.message)) {
        throw new Error('Git doesn’t know who you are yet. Sign in to GitHub in Setup first.')
      }
      throw e
    })
  }

  let pulled = 0
  if (s.upstream) {
    await git(dir, ['fetch', '--quiet'])
    fetched.set(dir, Date.now())
    s = (await status(dir)) ?? s
    if (s.behind) {
      pulled = s.behind
      try {
        await git(dir, ['pull', '--rebase', '--quiet'], 120_000)
      } catch (e) {
        const files = (await git(dir, ['diff', '--name-only', '--diff-filter=U']).catch(() => ''))
          .split('\n')
          .filter(Boolean)
        // Put things back as they were: your commit stays, nothing half-merged.
        await git(dir, ['rebase', '--abort']).catch(() => {})
        if (files.length) throw new SyncConflict(files)
        throw e
      }
    }
  }

  s = (await status(dir)) ?? s
  // A branch that isn't on GitHub yet goes up whole, and is tracked from then on.
  if (!s.upstream) {
    await git(dir, ['push', '-q', '-u', 'origin', 'HEAD'], 120_000)
    return { pushed: 0, pulled, newBranch: true }
  }
  if (s.ahead) await git(dir, ['push', '-q'], 120_000)
  return { pushed: s.ahead, pulled, newBranch: false }
}
