import { findProject, isCloud, loadConfig } from './config'
import { seedHello } from './hello'
import { launch } from './launch'
import * as pm from './processes'
import * as tasks from './tasks'
import { closeFixedCrashes, resumeInterrupted, understand } from './workflow'
import { startGateway } from './gateway'

// Server-only setup. Kept out of fns.ts: top-level code there would be shipped
// to the browser along with everything it imports.

const splitKey = (k: string) => {
  const i = k.indexOf(':')
  return [k.slice(0, i), k.slice(i + 1)] as const
}

/** Same error, different numbers (ports, line numbers, counts) → same task. */
const signatureOf = (text: string) =>
  text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()

/** A crashed service becomes a task; repeats of the same error bump its count. */
function recordCrash(k: string) {
  const [projectId, serviceId] = splitKey(k)
  const s = findProject(projectId)?.services.find((x) => x.id === serviceId)
  if (!s) return

  const recent = pm.logs(k, 60)
  const lastRun = recent.slice(Math.max(0, recent.map((l) => l.text.startsWith('$ ')).lastIndexOf(true)))
  const errLines = lastRun.filter(
    (l) => l.level === 'err' && !/^\s+at\s/.test(l.text) && !l.text.startsWith('Process exited'),
  )
  // Prefer a real error message ("TypeError: …") over other lines flagged as errors.
  const firstError = errLines.find((l) => /^\s*(\w*(Error|Exception)|ERR!)\b/.test(l.text)) ?? errLines[0]
  const headline = firstError
    ? firstError.text.trim().slice(0, 140)
    : `exited with code ${pm.view(k).exitCode ?? '?'}`

  tasks.recordCrash({
    projectId,
    serviceId,
    signature: `${serviceId}|${signatureOf(headline)}`,
    title: `${s.name}: ${headline}`,
    detail: lastRun.map((l) => l.text).join('\n').slice(-4000),
    sourceLabel: `Terminal · ${s.name}`,
  })
}

const boot = globalThis as unknown as { __pitwallResumed?: boolean; __pitwallTick?: NodeJS.Timeout }

/** Call from any server function; cheap after the first time. */
export function startLifecycle() {
  pm.onCrash(recordCrash)
  // Every new task is read by Claude as soon as it arrives.
  tasks.onNewTask((t) => void understand(t))
  // On a cloud machine, apps are reached through the gateway at <name>.<domain>.
  if (isCloud()) startGateway()
  // Replaced on every call, so a hot reload swaps in the new code.
  clearInterval(boot.__pitwallTick)
  boot.__pitwallTick = setInterval(closeFixedCrashes, 5000)
  boot.__pitwallTick.unref()
  if (boot.__pitwallResumed) return
  boot.__pitwallResumed = true
  resumeInterrupted()
  // Services you left running start again when Pitwall comes back.
  const projects = loadConfig()
  void (async () => {
    // A new cloud machine gets the sample project (only ever once).
    await seedHello().catch((e) => console.error('[pitwall] sample project:', e))
    // One at a time, so Expo apps don't race for the same free port.
    for (const k of pm.remembered()) {
      const [projectId, serviceId] = splitKey(k)
      const p = projects.find((x) => x.id === projectId)
      const s = p?.services.find((x) => x.id === serviceId)
      if (p && s) await launch(p, s)
    }
  })()
}
