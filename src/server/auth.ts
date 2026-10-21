import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Cloud mode's sign-in. The installer (or `pitwall link`) prints a link that
 * works once, and opening it gives you a session cookie. A password, if you set
 * one in Setup, signs you in from other devices without the server.
 * auth.json keeps a secret that signs the cookies and the hashes of unused
 * links; scripts/new-link.mjs writes the same format.
 */

const FILE = path.join(process.cwd(), '.pitwall', 'auth.json')

export const COOKIE = 'pitwall_session'
const MAX_AGE_S = 30 * 24 * 3600
const LINK_MS = 24 * 3600_000

interface AuthFile {
  secret: string
  /** Unused sign-in links: sha256 of the token, and when it stops working. */
  links?: { hash: string; expires: number }[]
  /** An optional password, set in Setup: scrypt$<salt hex>$<hash hex>. */
  hash?: string
  /** Lets phones open Expo apps without signing in: part of their phone host name. */
  phoneKey?: string
}

function read(): AuthFile | null {
  try {
    const a = JSON.parse(fs.readFileSync(FILE, 'utf8')) as AuthFile
    return a.secret ? a : null
  } catch {
    return null
  }
}

function write(a: AuthFile) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(a, null, 2), { mode: 0o600 })
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const live = (a: AuthFile) => (a.links ?? []).filter((l) => l.expires > Date.now())

/** A new sign-in link's token. */
export function newLink() {
  const a = read() ?? { secret: crypto.randomBytes(32).toString('hex') }
  const token = crypto.randomBytes(32).toString('base64url')
  write({ ...a, links: [...live(a), { hash: sha(token), expires: Date.now() + LINK_MS }] })
  return token
}

export const hasPassword = () => !!read()?.hash

// Lowercase letters and digits only, so it fits in a host name.
const newPhoneKey = () => crypto.randomBytes(16).toString('hex').slice(0, 16)

/** The key in Expo apps' phone host names, made the first time it's needed. */
export function phoneKey() {
  const a = read() ?? { secret: crypto.randomBytes(32).toString('hex') }
  if (a.phoneKey) return a.phoneKey
  const key = newPhoneKey()
  write({ ...a, phoneKey: key })
  return key
}

/** A new phone key: every phone link made before stops working. */
export function resetPhoneKey() {
  const a = read() ?? { secret: crypto.randomBytes(32).toString('hex') }
  const key = newPhoneKey()
  write({ ...a, phoneKey: key })
  return key
}

export function setPassword(password: string) {
  if (password.length < 12) throw new Error('Use at least 12 characters')
  const a = read() ?? { secret: crypto.randomBytes(32).toString('hex') }
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, 64)
  write({ ...a, hash: `scrypt$${salt.toString('hex')}$${hash.toString('hex')}` })
}

export function checkPassword(password: string) {
  const [, salt, hash] = read()?.hash?.split('$') ?? []
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'hex'), expected.length)
  return crypto.timingSafeEqual(expected, actual)
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

/** True once for a good token: it's used up as it signs you in. */
export function useLink(token: string) {
  const a = read()
  if (!a || !token) return false
  const want = Buffer.from(sha(token))
  const links = live(a)
  const match = links.find((l) => l.hash.length === want.length && crypto.timingSafeEqual(Buffer.from(l.hash), want))
  if (!match) return false
  write({ ...a, links: links.filter((l) => l !== match) })
  return true
}

const sign = (secret: string, data: string) => crypto.createHmac('sha256', secret).update(data).digest('base64url')

export function newSession() {
  const a = read()
  if (!a) throw new Error('Not set up. Run the installer, or scripts/new-link.mjs.')
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

/** The session cookie: on the dev domain, so it covers Pitwall and every app; with none yet, just this address. */
export function sessionCookie(domain: string | null, token: string | null) {
  const value = token ?? ''
  const age = token ? MAX_AGE_S : 0
  const scope = domain ? `Domain=.${domain}; ` : ''
  return `${COOKIE}=${value}; ${scope}Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`
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
