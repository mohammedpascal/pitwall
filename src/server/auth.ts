import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Cloud mode's one password. The installer stores only its scrypt hash, with a
 * secret that signs session cookies (scripts/set-password.mjs writes the same
 * format). Resetting the password replaces the secret, which signs everyone out.
 */

const FILE = path.join(process.cwd(), '.pitwall', 'auth.json')

export const COOKIE = 'pitwall_session'
const MAX_AGE_S = 30 * 24 * 3600

interface AuthFile {
  /** scrypt$<salt hex>$<hash hex> */
  hash: string
  secret: string
}

function read(): AuthFile | null {
  try {
    const a = JSON.parse(fs.readFileSync(FILE, 'utf8')) as AuthFile
    return a.hash && a.secret ? a : null
  } catch {
    return null
  }
}

export const hasPassword = () => read() !== null

export function checkPassword(password: string) {
  const a = read()
  if (!a) return false
  const [, salt, hash] = a.hash.split('$')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'hex'), expected.length)
  return crypto.timingSafeEqual(expected, actual)
}

const sign = (secret: string, data: string) => crypto.createHmac('sha256', secret).update(data).digest('base64url')

export function newSession() {
  const a = read()
  if (!a) throw new Error('No password set. Run the installer, or scripts/set-password.mjs.')
  const issued = String(Math.floor(Date.now() / 1000))
  return `${issued}.${sign(a.secret, issued)}`
}

export function validSession(token: string | undefined | null) {
  const a = read()
  if (!a || !token) return false
  const [issued, mac] = token.split('.')
  if (!issued || !mac) return false
  const good = sign(a.secret, issued)
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return false
  return Date.now() / 1000 - Number(issued) < MAX_AGE_S
}

/** The session cookie, on the dev domain so it covers Pitwall and every app. */
export function sessionCookie(domain: string, token: string | null) {
  const value = token ?? ''
  const age = token ? MAX_AGE_S : 0
  return `${COOKIE}=${value}; Domain=.${domain}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`
}

export function readCookie(header: string | undefined | null, name = COOKIE) {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

/** The cookie header without Pitwall's cookie, so apps never see it. */
export function withoutSessionCookie(header: string | undefined) {
  if (!header) return header
  const kept = header
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(`${COOKIE}=`))
  return kept.length ? kept.join('; ') : undefined
}

// Ten wrong passwords a minute per address, then wait.
const attempts = new Map<string, number[]>()
const WINDOW_MS = 60_000
const LIMIT = 10

export function tooManyAttempts(ip: string) {
  const now = Date.now()
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  attempts.set(ip, recent)
  return recent.length >= LIMIT
}

export function recordFailure(ip: string) {
  attempts.set(ip, [...(attempts.get(ip) ?? []), Date.now()])
}

/** Only send people back to Pitwall or one of the dev domain's apps after login. */
export function safeNext(next: string | null | undefined, domain: string) {
  if (!next) return '/'
  if (next.startsWith('/') && !next.startsWith('//')) return next
  try {
    const u = new URL(next)
    if (u.protocol === 'https:' && (u.hostname === domain || u.hostname.endsWith(`.${domain}`))) return u.toString()
  } catch {
    /* not a URL */
  }
  return '/'
}
