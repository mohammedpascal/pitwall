import https from 'node:https'
import { isCloud } from './config'

/**
 * Caddy gets each address's certificate the first time it's asked for, which
 * takes a few seconds; until then the browser just sees the connection reset.
 * So Pitwall asks first, from this machine, and says "setting up HTTPS" until
 * the address answers.
 */

type State = 'ready' | 'pending' | { failedAt: number }

const store = globalThis as unknown as { __pitwallCerts?: Map<string, State> }
const hosts = (store.__pitwallCerts ??= new Map<string, State>())

const RETRY_MS = 5_000
const TIMEOUT_MS = 60_000
// Caddy, on this machine. Overridable only to test against another server.
const PORT = Number(process.env.PITWALL_HTTPS_PORT) || 443

function attempt(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.request(
      { host: '127.0.0.1', port: PORT, servername: host, headers: { host }, method: 'HEAD', path: '/', timeout: TIMEOUT_MS },
      (res) => {
        // Any answer (even the gateway's redirect to the login) means HTTPS works.
        res.resume()
        resolve(true)
      },
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(false))
    req.end()
  })
}

const inFlight = new Map<string, Promise<boolean>>()

/** Makes sure the address has its certificate; true once it answers over HTTPS. */
export function warm(host: string): Promise<boolean> {
  if (!isCloud() || hosts.get(host) === 'ready') return Promise.resolve(true)
  const running = inFlight.get(host)
  if (running) return running
  hosts.set(host, 'pending')
  const p = attempt(host).then((ok) => {
    hosts.set(host, ok ? 'ready' : { failedAt: Date.now() })
    inFlight.delete(host)
    return ok
  })
  inFlight.set(host, p)
  return p
}

/** Whether the address works over HTTPS yet; asking starts (or retries) getting it ready. */
export function ready(host: string) {
  if (!isCloud()) return true
  const s = hosts.get(host)
  if (s === 'ready') return true
  if (!s || (s !== 'pending' && Date.now() - s.failedAt > RETRY_MS)) void warm(host)
  return false
}
