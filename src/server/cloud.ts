import { phoneKey } from './auth'
import { configuredDomain, loadConfig, serviceCwd, type ProjectConfig, type ServiceConfig } from './config'
import { isExpoApp } from './expo'
import { slug } from './scan'

/**
 * Cloud mode: every service gets its own name under the dev domain,
 * <project>-<service>.<domain>, and Pitwall lives at pitwall.<domain>.
 * Unique across projects; "pitwall" is never handed to a service.
 *
 * Expo apps also get a phone host, <project>-<service>--<key>.<domain>: Expo Go
 * and development builds can't sign in, so the secret key in the name lets them
 * through the gateway instead (see auth.ts phoneKey).
 */

export const cloudDomain = configuredDomain

export const pitwallHost = (domain: string) => `pitwall.${domain}`

export interface Route {
  host: string
  projectId: string
  serviceId: string
  serviceName: string
  /** Reached by the phone host: no login cookie needed. */
  phone?: boolean
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

/** The phone host for a route's host name. */
export const phoneHost = (host: string, key: string) => host.replace(/^([^.]+)/, `$1--${key}`)

/** An Expo app's phone host, or null when it isn't an Expo app or there's no domain. */
export function phoneHostFor(project: ProjectConfig, s: ServiceConfig): string | null {
  const host = hostFor(project, s)
  if (!host || !isExpoApp(serviceCwd(project, s), s.command)) return null
  return phoneHost(host, phoneKey())
}

export function routeForHost(host: string): Route | null {
  const domain = cloudDomain()
  if (!domain) return null
  const name = host.toLowerCase().replace(/:\d+$/, '')
  const projects = loadConfig()
  const all = routes(domain, projects)
  const route = all.find((r) => r.host === name)
  if (route) return route
  // A phone host: the right key, and only for an Expo app.
  const m = /^([^.]+)--([a-z0-9]+)\.(.+)$/.exec(name)
  if (!m || m[3] !== domain || m[2] !== phoneKey()) return null
  const phone = all.find((r) => r.host === `${m[1]}.${domain}`)
  const project = phone && projects.find((p) => p.id === phone.projectId)
  const s = project?.services.find((x) => x.id === phone!.serviceId)
  if (!phone || !project || !s || !isExpoApp(serviceCwd(project, s), s.command)) return null
  return { ...phone, host: name, phone: true }
}
