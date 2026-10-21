import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import * as certs from './certs'
import { hostFor, phoneHostFor } from './cloud'
import { isCloud, serviceCwd, type ProjectConfig, type ServiceConfig } from './config'
import { hasPortFlag, withPortFlags, withoutPortless } from './ports'
import { isExpoApp } from './expo'
import * as pm from './processes'
import { packageManager } from './scan'

/**
 * Every service start goes through here, so Pitwall can supply what an
 * interactive terminal would have.
 *
 * Expo: when its port (8081) is taken, `expo start` asks "Use port 8082
 * instead?". Pitwall's output isn't a terminal, so Expo can't ask and exits.
 * Expo reads RCT_METRO_PORT as its port when the command has no --port, so
 * Pitwall picks a free one and passes it that way. The project and its
 * command stay exactly as they are.
 *
 * A fresh clone has no node_modules; Pitwall installs them first, in the same
 * output, as you would in a terminal.
 */

// Ports handed to Expo services this session, so two starting at once don't collide.
const given = new Map<string, number>()

function canListen(port: number, host: string) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen({ port, host }, () => server.close(() => resolve(true)))
  })
}

/** Free on every interface and on loopback, like Metro needs. */
async function isFree(port: number) {
  return (await canListen(port, '::')) && (await canListen(port, '127.0.0.1'))
}

async function freePort(from: number, skip: Set<number>) {
  for (let port = from; port < from + 100; port++) {
    if (!skip.has(port) && (await isFree(port))) return port
  }
  return null
}

const isUp = (key: string) => {
  const st = pm.view(key).status
  return st === 'running' || st === 'starting'
}

/** Ports Pitwall gave to services in cloud mode, which the gateway falls back on. */
export function assignedPort(key: string) {
  return given.get(key) ?? null
}

/** `npm install && …` when the service's folder (or the project's, in a workspace) has none. */
function withInstall(command: string, cwd: string, root: string) {
  if (!fs.existsSync(path.join(cwd, 'package.json'))) return command
  const dirs = [...new Set([cwd, root])]
  if (dirs.some((d) => fs.existsSync(path.join(d, 'node_modules')))) return command
  // The lockfile says which package manager; a workspace keeps it at the project's root.
  const lockDir = dirs.find((d) => packageManager(d) !== 'npm') ?? cwd
  return `${packageManager(lockDir)} install && ${command}`
}

export async function launch(project: ProjectConfig, s: ServiceConfig) {
  const key = `${project.id}:${s.id}`
  if (isUp(key)) return
  const cwd = serviceCwd(project, s)
  const env: Record<string, string> = {}
  const cloud = isCloud()
  // On a cloud machine there's no portless; Pitwall routes to each service itself.
  let command = cloud ? withoutPortless(s.command) : s.command
  const taken = () => new Set([...given].filter(([k]) => k !== key && isUp(k)).map(([, port]) => port))

  const expo = isExpoApp(cwd, command)
  // The phone host, so Metro's manifest links to its public address, not localhost.
  const phone = cloud && expo ? phoneHostFor(project, s) : null
  if (phone) env.EXPO_PACKAGER_PROXY_URL = `https://${phone}`
  if (expo) {
    if (!hasPortFlag(command)) {
      const port = await freePort(Number(process.env.RCT_METRO_PORT) || 8081, taken())
      if (port) {
        given.set(key, port)
        env.RCT_METRO_PORT = String(port)
      }
    }
  } else if (cloud) {
    const port = await freePort(4100, taken())
    if (port) {
      given.set(key, port)
      env.PORT = String(port)
      env.HOST = '127.0.0.1'
      command = withPortFlags(command, cwd, port)
    }
  }

  pm.start(key, withInstall(command, cwd, project.path), cwd, env)
  // Get its address's certificate now, so it's ready by the time you open the app.
  const host = phone ?? (cloud ? hostFor(project, s) : null)
  if (host) void certs.warm(host)
}

export async function launchAll(project: ProjectConfig) {
  // One at a time, so each Expo app sees the ports the previous one took.
  for (const s of project.services) await launch(project, s)
}
