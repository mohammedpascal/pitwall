import fs from 'node:fs'
import path from 'node:path'
import { version } from './config'

const REPO = process.env.PITWALL_REPO?.trim() || 'mohammedpascal/pitwall'
const EVERY = 6 * 60 * 60 * 1000
/** The installer's root unit watches for this file and runs `pitwall update` when it appears. */
const REQUEST = path.join(process.cwd(), 'update-requested')
const WATCHER = '/etc/systemd/system/pitwall-update.path'

const parse = (v: string) => v.match(/^v?(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number) ?? null

/** Whether release `a` comes after release `b`; false when either isn't a plain vX.Y.Z. */
export function newer(a: string, b: string) {
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

let checked = 0
let latest: string | null = null
let pending: Promise<void> | null = null

async function check() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'pitwall' },
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) latest = ((await res.json()) as { tag_name?: string }).tag_name ?? null
  } catch {
    // Offline or GitHub is down: no update, and try again next time.
  } finally {
    checked = Date.now()
  }
}

/**
 * The newest release, when it's newer than this one. Only released builds check
 * (a dev checkout's version isn't vX.Y.Z); the answer is kept for six hours.
 */
export async function availableUpdate(): Promise<string | null> {
  if (!parse(version())) return null
  if (Date.now() - checked > EVERY) {
    pending ??= check().finally(() => (pending = null))
    await pending
  }
  return latest && newer(latest, version()) ? latest : null
}

/** Installed with the root unit that can update it; older installs need `sudo pitwall update`. */
export const canUpdate = () => fs.existsSync(WATCHER)

export function requestUpdate() {
  if (!canUpdate()) throw new Error('Run sudo pitwall update on the server once to turn on one-click updates')
  fs.writeFileSync(REQUEST, new Date().toISOString() + '\n')
}
