import http from 'node:http'
import https from 'node:https'
import { getRequestUrl } from '@tanstack/react-start/server'

/**
 * Can a running service be shown inside Pitwall? Load its page once and check:
 *  - it's a web page (HTML), not an API returning JSON or text
 *  - it doesn't forbid framing (X-Frame-Options, CSP frame-ancestors)
 * The answer is cached per run.
 */

export interface WebPreview {
  url: string
  embeddable: boolean
}

const PRIVATE_IP = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/

/** Pitwall runs on https, which blocks http frames from LAN IPs. Loopback is allowed. */
function frameUrl(url: string) {
  const u = new URL(url)
  if (PRIVATE_IP.test(u.hostname)) u.hostname = 'localhost'
  return u.toString()
}

function head(url: string): Promise<http.IncomingMessage | null> {
  return new Promise((resolve) => {
    const u = new URL(url)
    const get = u.protocol === 'https:' ? https.get : http.get
    // Local dev only: portless and similar tools use a local certificate authority.
    const req = get(u, { timeout: 2500, rejectUnauthorized: false, headers: { accept: 'text/html' } }, (res) => {
      res.resume()
      resolve(res)
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
  })
}

/** Where Pitwall itself is served, e.g. https://pitwall.localhost. */
function pitwallOrigin() {
  if (process.env.PORTLESS_URL) return new URL(process.env.PORTLESS_URL).origin
  try {
    return getRequestUrl({ xForwardedHost: true, xForwardedProto: true }).origin
  } catch {
    return null
  }
}

/** Does one frame-ancestors source ('*', 'https:', https://*.localhost, an origin) admit `origin`? */
function sourceMatches(source: string, origin: string) {
  if (source === '*') return true
  const o = new URL(origin)
  if (/^[a-z]+:$/i.test(source)) return o.protocol === source.toLowerCase()
  const m = source.match(/^(?:([a-z]+):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?\/?$/i)
  if (!m) return false
  const [, scheme, wildcard, host, port] = m
  if (scheme && `${scheme.toLowerCase()}:` !== o.protocol) return false
  const hostOk = wildcard ? o.hostname.endsWith(`.${host}`) : o.hostname === host.toLowerCase()
  const portOk = !port || port === '*' || port === (o.port || (o.protocol === 'https:' ? '443' : '80'))
  return hostOk && portOk
}

function allowsFraming(res: http.IncomingMessage) {
  const xfo = String(res.headers['x-frame-options'] ?? '').toLowerCase()
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return false
  // Only the enforced policy counts; browsers ignore frame-ancestors in report-only.
  const csp = String(res.headers['content-security-policy'] ?? '')
  const ancestors = csp.match(/frame-ancestors([^;,]*)/i)?.[1].trim()
  if (ancestors === undefined) return true
  const origin = pitwallOrigin()
  return ancestors.split(/\s+/).some((src) => src === '*' || (!!origin && sourceMatches(src, origin)))
}

// Answers are re-checked every 20s, so changing an app's headers shows up without a restart.
const cache = new Map<string, { value: WebPreview | null; at: number }>()
const TTL = 20_000
const attempts = new Map<string, number>()
const MAX_ATTEMPTS = 15

export async function webPreview(opts: {
  key: string
  url: string | null
  startedAt: number | null
}): Promise<WebPreview | null> {
  const { key, url, startedAt } = opts
  if (!url) return null
  const cacheKey = `${key}|${url}|${startedAt}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < TTL) return hit.value

  const target = frameUrl(url)
  const res = await head(target)
  const status = res?.statusCode ?? 0

  // Only a success or redirect is the app's real answer. While an app starts,
  // a proxy like portless answers for it with its own 404/502 page, which says
  // nothing about the app's framing rules, so ask again on the next poll.
  if (!res || status < 200 || status >= 400) {
    const n = (attempts.get(cacheKey) ?? 0) + 1
    attempts.set(cacheKey, n)
    if (n >= MAX_ATTEMPTS) cache.set(cacheKey, { value: null, at: Date.now() }) // e.g. an API whose / is a 404
    return hit?.value ?? null
  }

  const type = String(res.headers['content-type'] ?? '')
  const isPage = status >= 300 || type.includes('text/html')
  const preview = isPage ? { url: target, embeddable: allowsFraming(res) } : null
  cache.set(cacheKey, { value: preview, at: Date.now() })
  attempts.delete(cacheKey)
  return preview
}
