import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { childEnv } from './agent'

/**
 * What Claude can use in a project: its MCP servers and skills, as Claude
 * Code itself configures them. Commands, headers and env often hold API keys,
 * so none of them ever leave this file: a server is a name, where it runs,
 * its scope and its status.
 */

export type McpScope = 'project' | 'repo' | 'user' | 'account' | 'plugin'
export type McpStatus = 'connected' | 'failed' | 'sign-in' | 'unchecked' | 'unknown'

export interface McpServer {
  name: string
  scope: McpScope
  /** The URL's host, or the command's program: never its arguments. */
  where: string
  status: McpStatus
  reason?: string
}

export interface Skill {
  name: string
  description: string
  scope: 'repo' | 'personal'
}

type Raw = { type?: string; url?: string; command?: string; args?: string[] }

function readJson(file: string): Record<string, any> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

const claudeJson = () => readJson(path.join(os.homedir(), '.claude.json')) ?? {}

function where(s: Raw) {
  if (s.url) {
    try {
      return new URL(s.url).host
    } catch {
      return 'a URL'
    }
  }
  const prog = path.basename(s.command ?? '')
  // npx/uvx/bunx run a package: its name says more than "npx". Only that one word, never the rest.
  if (/^(npx|uvx|bunx|pnpx)$/.test(prog)) {
    const pkg = (s.args ?? []).find((a) => !a.startsWith('-'))
    const url = (s.args ?? []).find((a) => /^https?:\/\//.test(a))
    if (pkg === 'mcp-remote' && url) return where({ url })
    if (pkg) return pkg.replace(/@latest$/, '')
  }
  return prog || 'a command'
}

function run(dir: string, args: string[], timeout = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('claude', args, { cwd: dir, env: childEnv(), timeout, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      if (err) {
        const last = `${stderr || stdout}`.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
        return reject(new Error(last || err.message))
      }
      resolve(stdout)
    })
  })
}

// `claude mcp list` health-checks every server, which takes a few seconds: once per 30 s per folder.
const statusCache = new Map<string, { at: number; value: Promise<Map<string, { status: McpStatus; reason?: string }>> }>()

function statuses(dir: string, fresh = false) {
  const hit = statusCache.get(dir)
  if (!fresh && hit && Date.now() - hit.at < 30_000) return hit.value
  const value = run(dir, ['mcp', 'list'], 60_000)
    .then((out) => {
      const map = new Map<string, { status: McpStatus; reason?: string }>()
      for (const line of out.split('\n')) {
        // "name: <target> - ✔ Connected". The target can hold secrets; only the name and the status are read.
        const m = /^(.+?): .*? - ([✔✘!⏸].*)$/.exec(line.trim())
        if (!m) continue
        const [, name, tail] = m
        const t = tail.trim()
        // "Pending approval" is the terminal's question about a repo's .mcp.json; Pitwall's tasks run
        // headless, where those servers load without asking. So it only means "not checked here".
        const status: McpStatus = t.startsWith('✔')
          ? 'connected'
          : /pending approval/i.test(t)
            ? 'unchecked'
            : /needs authentication/i.test(t)
              ? 'sign-in'
              : t.startsWith('✘')
                ? 'failed'
                : 'unknown'
        const reason =
          status === 'failed'
            ? t
                .replace(/^✘\s*Failed to connect\s*—?\s*/i, '')
                // An error can quote what it was given: never pass on anything that looks like a key.
                .replace(/\bbearer\s+\S+/gi, 'Bearer …')
                .replace(/\b(?=[\w-]*\d)(?=[\w-]*[a-zA-Z])[\w-]{24,}\b/g, '…')
                .slice(0, 160)
            : undefined
        map.set(name, { status, ...(reason ? { reason } : {}) })
      }
      return map
    })
    .catch(() => new Map<string, { status: McpStatus; reason?: string }>())
  statusCache.set(dir, { at: Date.now(), value })
  return value
}

/** Every server Claude can use in this folder, with where it's configured and how it's doing. */
export async function mcpServers(dir: string, fresh = false): Promise<McpServer[]> {
  const cfg = claudeJson()
  const found: Omit<McpServer, 'status'>[] = []
  const add = (scope: McpScope, servers: Record<string, Raw> | undefined) => {
    for (const [name, s] of Object.entries(servers ?? {})) {
      if (!found.some((f) => f.name === name)) found.push({ name, scope, where: where(s) })
    }
  }
  // Claude Code's own precedence: this project's, then the repo's, then everyone's.
  add('project', cfg.projects?.[dir]?.mcpServers)
  add('repo', readJson(path.join(dir, '.mcp.json'))?.mcpServers)
  add('user', cfg.mcpServers)
  const known = await statuses(dir, fresh)
  // Claude Code also lists servers from your claude.ai account and from plugins; they're usable too.
  for (const name of known.keys()) {
    if (found.some((f) => f.name === name)) continue
    if (name.startsWith('claude.ai ')) found.push({ name: name.slice(10), scope: 'account', where: 'claude.ai' })
    else if (name.startsWith('plugin:')) found.push({ name: name.split(':').at(-1)!, scope: 'plugin', where: name.split(':')[1] })
  }
  const key = (f: Omit<McpServer, 'status'>) =>
    f.scope === 'account' ? `claude.ai ${f.name}` : f.scope === 'plugin' ? [...known.keys()].find((k) => k.startsWith('plugin:') && k.endsWith(`:${f.name}`))! : f.name
  return found.map((f) => ({ ...f, ...(known.get(key(f)) ?? { status: 'unknown' as const }) }))
}

/** Splits a command line like a shell would, quotes included, without running one. */
function words(line: string) {
  const out: string[] = []
  for (const m of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/** For this project on this machine only, so its keys are never committed. */
export async function addServer(dir: string, input: { name: string; target: string; headers: string[]; env: string[] }) {
  const name = input.name.trim()
  if (!/^[\w.-]+$/.test(name)) throw new Error('Give it a short name: letters, numbers, dots, dashes')
  const target = input.target.trim()
  if (!target) throw new Error('Give its URL or the command that starts it')
  const args = ['mcp', 'add', '-s', 'local']
  if (/^https?:\/\//i.test(target)) {
    args.push('--transport', 'http')
    for (const h of input.headers.map((x) => x.trim()).filter(Boolean)) args.push('--header', h)
    args.push(name, target)
  } else {
    for (const e of input.env.map((x) => x.trim()).filter(Boolean)) args.push('-e', e)
    args.push(name, '--', ...words(target))
  }
  await run(dir, args)
  statusCache.delete(dir)
}

export async function removeServer(dir: string, name: string) {
  await run(dir, ['mcp', 'remove', '-s', 'local', name])
  statusCache.delete(dir)
}

/** name and description from a SKILL.md's front matter. */
function frontMatter(text: string) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const field = (k: string) => {
    const m = new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(block)
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
  }
  return { name: field('name'), description: field('description') }
}

function skillsIn(root: string, scope: Skill['scope']): Skill[] {
  let dirs: string[]
  try {
    dirs = fs.readdirSync(root)
  } catch {
    return []
  }
  const out: Skill[] = []
  for (const d of dirs) {
    try {
      const fm = frontMatter(fs.readFileSync(path.join(root, d, 'SKILL.md'), 'utf8'))
      out.push({ name: fm.name || d, description: fm.description, scope })
    } catch {
      /* not a skill folder */
    }
  }
  return out
}

/** This repo's skills first, then your personal ones; a repo skill wins on the same name. */
export function skills(dir: string): Skill[] {
  const repo = skillsIn(path.join(dir, '.claude', 'skills'), 'repo')
  const mine = skillsIn(path.join(os.homedir(), '.claude', 'skills'), 'personal').filter(
    (s) => !repo.some((r) => r.name === s.name),
  )
  return [...repo, ...mine].sort((a, b) => (a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === 'repo' ? -1 : 1))
}
