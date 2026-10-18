import fs from 'node:fs'
import path from 'node:path'

/**
 * Most dev servers read PORT. These don't, and need --port (and --host) on
 * their command line instead. Same list portless uses.
 */
const NEEDS_FLAGS: Record<string, { strictPort: boolean }> = {
  vite: { strictPort: true },
  vp: { strictPort: true },
  'react-router': { strictPort: true },
  rsbuild: { strictPort: false },
  astro: { strictPort: false },
  ng: { strictPort: false },
}

const RUNNERS: Record<string, string[]> = { npx: [], bunx: [], pnpx: [], yarn: ['dlx', 'exec'], pnpm: ['dlx', 'exec'] }

export const hasPortFlag = (command: string) => /(^|\s)(--port|-p)(\s|=)/.test(command)

/** `portless guidepal bun run dev` → `bun run dev`. */
export function withoutPortless(command: string) {
  const words = command.trim().split(/\s+/)
  if (words[0] !== 'portless') return command
  let i = 1
  while (i < words.length && words[i].startsWith('-')) i++
  i++ // the app name, or "run"
  return words.slice(i).join(' ') || command
}

/** The framework a command line starts, looking past npx / pnpm dlx and VAR=value prefixes. */
function frameworkOf(words: string[]): string | null {
  let i = 0
  while (i < words.length && /^\w+=/.test(words[i])) i++
  if (words[i] === 'cross-env') {
    i++
    while (i < words.length && /^\w+=/.test(words[i])) i++
  }
  const first = path.basename(words[i] ?? '')
  if (NEEDS_FLAGS[first]) return first
  const sub = RUNNERS[first]
  if (!sub) return null
  i++
  while (i < words.length && words[i].startsWith('-')) i++
  if (sub.length && sub.includes(words[i])) i++
  while (i < words.length && words[i].startsWith('-')) i++
  const name = path.basename(words[i] ?? '')
  return NEEDS_FLAGS[name] ? name : null
}

/** `npm run dev`, `bun run dev`, `pnpm dev`, `yarn dev` → the script's name and the package manager. */
function scriptOf(words: string[]): { pm: string; script: string } | null {
  const [pm, a, b] = words
  if (!['npm', 'pnpm', 'bun', 'yarn'].includes(pm)) return null
  if (a === 'run' || a === 'run-script') return b ? { pm, script: b } : null
  // pnpm dev / yarn dev (npm needs "run"; bun <file> runs a file).
  if ((pm === 'pnpm' || pm === 'yarn') && a && !a.startsWith('-')) return { pm, script: a }
  return null
}

function readScripts(cwd: string): Record<string, string> {
  try {
    return (JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).scripts ?? {}) as Record<string, string>
  } catch {
    return {}
  }
}

/**
 * Add --port/--host for servers that ignore PORT, so each service listens on
 * the port Pitwall picked. Commands that already choose a port are left alone.
 */
export function withPortFlags(command: string, cwd: string, port: number) {
  if (hasPortFlag(command)) return command
  const words = command.trim().split(/\s+/)
  let framework = frameworkOf(words)
  let viaScript: { pm: string; script: string } | null = null
  if (!framework) {
    viaScript = scriptOf(words)
    const body = viaScript ? readScripts(cwd)[viaScript.script] : undefined
    // Only the first command of the script gets the flags ("vite dev && …" is rare).
    if (!body || hasPortFlag(body)) return command
    framework = frameworkOf(body.split(/&&|;|\|/)[0].trim().split(/\s+/))
  }
  if (!framework) return command
  const flags = ['--port', String(port), ...(NEEDS_FLAGS[framework].strictPort ? ['--strictPort'] : []), '--host', '127.0.0.1']
  // npm needs "--" before arguments meant for the script; bun, pnpm and yarn pass them on.
  const sep = viaScript?.pm === 'npm' && !words.includes('--') ? ['--'] : []
  return [command.trim(), ...sep, ...flags].join(' ')
}
