import { configuredDomain, loadConfig, type ProjectConfig, type ServiceConfig } from './config'
import { slug } from './scan'

/**
 * Cloud mode: every service gets its own name under the dev domain,
 * <project>-<service>.<domain>, and Pitwall lives at pitwall.<domain>.
 * Unique across projects; "pitwall" is never handed to a service.
 */

export const cloudDomain = configuredDomain

export const pitwallHost = (domain: string) => `pitwall.${domain}`

export interface Route {
  host: string
  projectId: string
  serviceId: string
  serviceName: string
}

/** Every service's host name, in config order (earlier services keep a name on a clash). */
export function routes(domain: string, projects: ProjectConfig[] = loadConfig()): Route[] {
  const taken = new Set(['pitwall'])
  const out: Route[] = []
  for (const p of projects) {
    for (const s of p.services) {
      const base = `${slug(p.id)}-${slug(s.name)}`
      let label = base
      for (let i = 2; taken.has(label); i++) label = `${base}-${i}`
      taken.add(label)
      out.push({ host: `${label}.${domain}`, projectId: p.id, serviceId: s.id, serviceName: s.name })
    }
  }
  return out
}

export function hostFor(project: ProjectConfig, s: ServiceConfig): string | null {
  const domain = cloudDomain()
  if (!domain) return null
  return routes(domain).find((r) => r.projectId === project.id && r.serviceId === s.id)?.host ?? null
}

export function routeForHost(host: string): Route | null {
  const domain = cloudDomain()
  if (!domain) return null
  const name = host.toLowerCase().replace(/:\d+$/, '')
  return routes(domain).find((r) => r.host === name) ?? null
}
