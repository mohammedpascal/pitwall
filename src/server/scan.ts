import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { displayPath, expand, loadConfig } from './config'
import type { DetectedService, PackageManager, ScanResult } from './types'

interface Pkg {
  name?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  workspaces?: string[] | { packages?: string[] }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

export function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/^@[^/]+\//, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  )
}

function title(s: string) {
  const name = s.replace(/^@[^/]+\//, '').replace(/[-_]+/g, ' ')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function packageManager(dir: string): PackageManager {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn'
  if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) return 'bun'
  return 'npm'
}

function runScript(pm: PackageManager, script: string) {
  if (pm === 'yarn') return `yarn ${script}`
  return `${pm} run ${script}`
}

let portlessCache: boolean | null = null
function hasPortless() {
  if (portlessCache === null) {
    try {
      execFileSync('sh', ['-c', 'command -v portless'], { stdio: 'ignore' })
      portlessCache = true
    } catch {
      portlessCache = false
    }
  }
  return portlessCache
}

/** Workspace globs from package.json or pnpm-workspace.yaml, expanded one level ("apps/*"). */
function workspaceDirs(root: string, pkg: Pkg | null): string[] {
  let patterns: string[] = []
  if (Array.isArray(pkg?.workspaces)) patterns = pkg.workspaces
  else if (pkg?.workspaces?.packages) patterns = pkg.workspaces.packages

  const pnpmFile = path.join(root, 'pnpm-workspace.yaml')
  if (!patterns.length && fs.existsSync(pnpmFile)) {
    const text = fs.readFileSync(pnpmFile, 'utf8')
    patterns = [...text.matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)].map((m) => m[1])
  }

  const dirs: string[] = []
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) continue
    const clean = pattern.replace(/\/\*\*?$/, '')
    if (clean !== pattern) {
      const parent = path.join(root, clean)
      if (!fs.existsSync(parent)) continue
      for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          dirs.push(path.join(clean, entry.name))
        }
      }
    } else if (fs.existsSync(path.join(root, clean))) {
      dirs.push(clean)
    }
  }
  return dirs.filter((d) => fs.existsSync(path.join(root, d, 'package.json'))).sort()
}

const FRAMEWORKS: [dep: string, kind: string][] = [
  ['expo', 'Expo'],
  ['next', 'Next.js'],
  ['@tanstack/react-start', 'TanStack Start'],
  ['nuxt', 'Nuxt'],
  ['astro', 'Astro'],
  ['@sveltejs/kit', 'SvelteKit'],
  ['@react-router/dev', 'React Router'],
  ['@remix-run/dev', 'Remix'],
  ['@nestjs/core', 'NestJS'],
  ['hono', 'Hono'],
  ['fastify', 'Fastify'],
  ['express', 'Express'],
  ['koa', 'Koa'],
  ['vite', 'Vite'],
]

/** Proposed ways to run one package: its main dev server plus any extra dev scripts (off by default). */
function servicesFor(
  root: string,
  rel: string,
  pm: PackageManager,
  projectSlug: string,
  multi: boolean,
  notes: string[],
): DetectedService[] {
  const pkg = readJson<Pkg>(path.join(root, rel, 'package.json'))
  if (!pkg) return []
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const kind = FRAMEWORKS.find(([dep]) => dep in deps)?.[1]
  const scripts = pkg.scripts ?? {}
  // The folder name beats package.json's name, which is often a starter template's ("tanstack-start-ts").
  const base = rel ? path.basename(rel) : projectSlug
  const id = slug(base)
  const name = title(base)

  if (kind === 'Expo') {
    // Expo serves Metro to a phone over the network, so it stays off portless.
    return [{ id, name, command: 'npx expo start', cwd: rel, kind, enabled: true }]
  }

  const out: DetectedService[] = []
  const main = ['dev', 'start', 'serve'].find((s) => scripts[s])
  if (main) {
    const body = scripts[main]
    let command = runScript(pm, main)
    if (/(^|\s)portless(\s|$)/.test(body)) {
      // The script already runs through portless.
    } else if (/(^|\s)(--port|-p)[\s=]\d+/.test(body)) {
      notes.push(`${name}’s ${main} script sets its own port, so it runs on that port instead of a portless URL.`)
    } else if (hasPortless()) {
      command = `portless ${multi && rel ? `${id}.${projectSlug}` : projectSlug} ${command}`
    }
    out.push({ id, name, command, cwd: rel, kind: kind ?? 'Node', enabled: true })
  }

  // Extra long-running scripts such as "worker:dev" or "dev:web".
  for (const script of Object.keys(scripts)) {
    const m = script.match(/^([\w-]+):dev$/) ?? script.match(/^dev:([\w-]+)$/)
    if (!m || script === main || /^(build|test|lint|typecheck|check|db|format)$/.test(m[1])) continue
    out.push({
      id: slug(`${id}-${m[1]}`),
      // "Web · Worker" in a multi-app folder; just "Worker" for the root app.
      name: `${rel ? `${name} · ` : ''}${title(m[1])}`,
      command: runScript(pm, script),
      cwd: rel,
      kind: `Script · ${script}`,
      enabled: false,
    })
  }
  return out
}

/** Folders one level down that have their own package.json (apps kept side by side without workspaces). */
function appSubfolders(root: string): string[] {
  const skip = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'tmp', 'temp'])
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !skip.has(e.name))
      .map((e) => e.name)
      .filter((d) => fs.existsSync(path.join(root, d, 'package.json')))
      .sort()
  } catch {
    return []
  }
}

function composeService(root: string): DetectedService | null {
  const file = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'].find(
    (f) => fs.existsSync(path.join(root, f)),
  )
  if (!file) return null
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  const block = text.split(/^services:\s*$/m)[1] ?? ''
  const names = [...block.matchAll(/^ {2}([A-Za-z0-9_.-]+):\s*$/gm)].map((m) => m[1])
  return {
    id: 'docker',
    name: 'Docker',
    command: 'docker compose up',
    cwd: '',
    kind: names.length ? `Compose · ${names.slice(0, 4).join(', ')}` : 'Docker Compose',
    enabled: true,
  }
}

function uniqueIds(services: DetectedService[]) {
  const seen = new Map<string, number>()
  return services.map((s) => {
    const n = seen.get(s.id) ?? 0
    seen.set(s.id, n + 1)
    return n ? { ...s, id: `${s.id}-${n + 1}` } : s
  })
}

export function scanFolder(input: string): ScanResult {
  const root = expand(input.trim())
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`No folder at ${displayPath(root)}`)
  }

  const folderSlug = slug(path.basename(root))
  const existing = new Set(loadConfig().map((p) => p.id))
  let suggestedId = slug(path.basename(root))
  for (let i = 2; existing.has(suggestedId); i++) suggestedId = `${slug(path.basename(root))}-${i}`

  const rootPkg = readJson<Pkg>(path.join(root, 'package.json'))
  const pm = packageManager(root)
  const workspaces = workspaceDirs(root, rootPkg)
  const monorepo = workspaces.length > 0
  const notes: string[] = []

  const services: DetectedService[] = []
  const compose = composeService(root)
  if (compose) services.push(compose)

  if (monorepo) {
    for (const rel of workspaces) services.push(...servicesFor(root, rel, pm, folderSlug, true, notes))
    const found = new Set(services.map((s) => s.cwd))
    const skipped = workspaces.filter((w) => !found.has(w)).length
    if (skipped > 0) {
      notes.push(`Skipped ${skipped} workspace package${skipped === 1 ? '' : 's'} with no dev or start script (libraries).`)
    }
    if (rootPkg?.scripts?.dev) {
      services.push({
        id: 'all',
        name: 'All (root)',
        command: runScript(pm, 'dev'),
        cwd: '',
        kind: 'Root dev script',
        enabled: false,
      })
      notes.push('The root dev script starts everything at once, so it is off by default. Each app is listed on its own instead.')
    }
  } else {
    const subfolders = appSubfolders(root)
    const multi = subfolders.length > 0
    if (rootPkg) services.push(...servicesFor(root, '', pm, folderSlug, multi, notes))
    for (const rel of subfolders) {
      const sub = servicesFor(root, rel, packageManager(path.join(root, rel)), folderSlug, true, notes)
      services.push(...sub)
    }
    if (multi && services.filter((s) => s.cwd).length === 0) {
      notes.push('Found subfolders with a package.json, but none has a dev or start script.')
    }
  }

  if (services.some((s) => !s.enabled && s.kind.startsWith('Script'))) {
    notes.push('Extra dev scripts (workers, watchers) are listed but off. Turn on the ones you run.')
  }
  if (!services.length && !notes.length) notes.push('No package.json or compose file found here. Add services by hand.')
  if (!hasPortless() && services.some((s) => s.kind !== 'Expo' && !s.kind.startsWith('Compose'))) {
    notes.push('portless is not installed, so services run on their usual ports. Install it with npm i -g portless.')
  }

  return {
    path: root,
    displayPath: displayPath(root),
    suggestedId,
    suggestedName: path.basename(root),
    packageManager: pm,
    portless: hasPortless(),
    services: uniqueIds(services),
    notes,
  }
}

/** Folder suggestions while typing a path: subfolders of the typed parent that match the last segment. */
export function suggestFolders(input: string): string[] {
  const raw = input.trim() || '~/'
  const full = expand(raw)
  const endsWithSlash = raw.endsWith('/')
  const parent = endsWithSlash ? full : path.dirname(full)
  const prefix = endsWithSlash ? '' : path.basename(full).toLowerCase()
  try {
    return fs
      .readdirSync(parent, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith('.') &&
          e.name !== 'node_modules' &&
          e.name.toLowerCase().startsWith(prefix),
      )
      .map((e) => displayPath(path.join(parent, e.name)) + '/')
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 40)
  } catch {
    return []
  }
}
