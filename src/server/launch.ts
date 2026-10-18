import net from 'node:net'
import { configuredDomain, serviceCwd, type ProjectConfig, type ServiceConfig } from './config'
import { hasPortFlag, withPortFlags, withoutPortless } from './ports'
import { isExpoApp } from './expo'
import * as pm from './processes'

/**
 * Every service start goes through here, so Pitwall can supply what an
 * interactive terminal would have.
 *
 * Expo: when its port (8081) is taken, `expo start` asks "Use port 8082
 * instead?". Pitwall's output isn't a terminal, so Expo can't ask and exits.
 * Expo reads RCT_METRO_PORT as its port when the command has no --port, so
 * Pitwall picks a free one and passes it that way. The project and its
 * command stay exactly as they are.
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

export async function launch(project: ProjectConfig, s: ServiceConfig) {
  const key = `${project.id}:${s.id}`
  if (isUp(key)) return
  const cwd = serviceCwd(project, s)
  const env: Record<string, string> = {}
  const cloud = !!configuredDomain()
  // On a cloud machine there's no portless; Pitwall routes to each service itself.
  let command = cloud ? withoutPortless(s.command) : s.command
  const taken = () => new Set([...given].filter(([k]) => k !== key && isUp(k)).map(([, port]) => port))

  if (isExpoApp(cwd, command)) {
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

  pm.start(key, command, cwd, env)
}

export async function launchAll(project: ProjectConfig) {
  // One at a time, so each Expo app sees the ports the previous one took.
  for (const s of project.services) await launch(project, s)
}
