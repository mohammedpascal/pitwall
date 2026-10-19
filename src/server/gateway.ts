import http from 'node:http'
import net from 'node:net'
import { readCookie, validSession, withoutSessionCookie } from './auth'
import { cloudDomain, pitwallHost, routeForHost, type Route } from './cloud'
import { assignedPort } from './launch'
import * as pm from './processes'

/**
 * Cloud mode's front door for apps. Caddy hands every <name>.<domain> request
 * here, so Caddy never needs to know the domain and it can change any time.
 * pitwall.<domain> goes on to Pitwall itself, as it is. For the rest the gateway
 * checks the login cookie, finds the service by host name, and proxies to the
 * port it listens on, WebSockets included, so hot reload works.
 */

const PORT = Number(process.env.PITWALL_GATEWAY_PORT) || 3001
// Pitwall's own port: server.mjs listens on PORT.
const UI_PORT = Number(process.env.PORT) || 3000

type Handlers = {
  request: (req: http.IncomingMessage, res: http.ServerResponse) => void
  upgrade: (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => void
}

// The server is made once; its handlers are swapped on every hot reload.
const store = globalThis as unknown as { __pitwallGateway?: http.Server; __pitwallGatewayHandlers?: Handlers }

const hostOf = (req: http.IncomingMessage) =>
  String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '')

const signedIn = (req: http.IncomingMessage) => validSession(readCookie(req.headers.cookie))

/** Where the service listens: the address it printed, else the port Pitwall gave it. */
function upstream(route: Route): { host: string; port: number } | null {
  const key = `${route.projectId}:${route.serviceId}`
  const v = pm.view(key)
  if (v.status !== 'running' && v.status !== 'starting') return null
  if (v.url) {
    try {
      const u = new URL(v.url)
      const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80)
      // 0.0.0.0 and localhost both mean "this machine". Dial "localhost": Node
      // tries 127.0.0.1 and ::1, and a dev server bound to "localhost" may be on either.
      return { host: 'localhost', port }
    } catch {
      /* fall back to the assigned port */
    }
  }
  const port = assignedPort(key)
  return port ? { host: 'localhost', port } : null
}

function page(res: http.ServerResponse, status: number, title: string, body: string, refresh = false) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex',
  })
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${refresh ? '<meta http-equiv="refresh" content="2">' : ''}<title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f6f4;color:#111;font:15px/1.6 system-ui,sans-serif}
main{max-width:420px;padding:32px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#666;margin:0 0 20px}
a{display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:500}</style></head>
<body><main><h1>${title}</h1>${body}</main></body></html>`)
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function toLogin(req: http.IncomingMessage, res: http.ServerResponse, domain: string) {
  const next = `https://${hostOf(req)}${req.url ?? '/'}`
  const login = `https://${pitwallHost(domain)}/login?next=${encodeURIComponent(next)}`
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.writeHead(302, { location: login, 'cache-control': 'no-store' })
    res.end()
  } else {
    res.writeHead(401, { 'content-type': 'text/plain' })
    res.end('Sign in to Pitwall first')
  }
}

/** Headers for the service: its own Host (dev servers check it), Pitwall's cookie removed. */
function forwardHeaders(req: http.IncomingMessage, target: { host: string; port: number }) {
  const headers = { ...req.headers }
  const host = hostOf(req)
  headers.host = `localhost:${target.port}`
  const cookie = withoutSessionCookie(req.headers.cookie)
  if (cookie) headers.cookie = cookie
  else delete headers.cookie
  headers['x-forwarded-host'] = host
  headers['x-forwarded-proto'] = 'https'
  headers['x-forwarded-for'] = [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ')
  return headers
}

/** In Pitwall's preview frame only, drop the headers that forbid framing. */
function framedByPitwall(req: http.IncomingMessage, domain: string) {
  if (req.headers['sec-fetch-dest'] !== 'iframe') return false
  const from = String(req.headers.referer ?? '')
  return from.startsWith(`https://${pitwallHost(domain)}/`)
}

function responseHeaders(req: http.IncomingMessage, upstreamRes: http.IncomingMessage, domain: string, port: number) {
  const headers = { ...upstreamRes.headers }
  headers['x-robots-tag'] = 'noindex'
  // Redirects the app makes to its local address point at its public one instead.
  const loc = headers.location
  if (typeof loc === 'string') {
    headers.location = loc.replace(new RegExp(`^https?://(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0):${port}`), `https://${hostOf(req)}`)
  }
  if (framedByPitwall(req, domain)) {
    delete headers['x-frame-options']
    const csp = headers['content-security-policy']
    if (typeof csp === 'string') {
      const kept = csp
        .split(';')
        .filter((d) => !/^\s*frame-ancestors\b/i.test(d))
        .join(';')
      if (kept.trim()) headers['content-security-policy'] = kept
      else delete headers['content-security-policy']
    }
  }
  return headers
}

const isPitwall = (req: http.IncomingMessage, domain: string | null) => !!domain && hostOf(req) === pitwallHost(domain)

const handlers: Handlers = {
  request(req, res) {
    const domain = cloudDomain()
    if (!domain) return page(res, 404, 'Not set up', '<p>Pitwall has no dev domain configured.</p>')
    // Pitwall checks its own sign-in; the headers (Host, X-Forwarded-For from Caddy) pass through untouched.
    if (isPitwall(req, domain)) {
      const out = http.request({ host: '127.0.0.1', port: UI_PORT, method: req.method, path: req.url, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.statusMessage, r.headers)
        r.pipe(res)
      })
      out.on('error', () => (res.headersSent ? res.destroy() : page(res, 502, 'Pitwall is restarting', '<p>This page retries by itself.</p>', true)))
      return void req.pipe(out)
    }
    if (!signedIn(req)) return toLogin(req, res, domain)
    const host = hostOf(req)
    const route = routeForHost(host)
    const pitwall = `https://${pitwallHost(domain)}`
    if (!route) {
      return page(res, 404, 'Nothing here', `<p>No service is called ${esc(host)}.</p><a href="${pitwall}/">Open Pitwall</a>`)
    }
    const target = upstream(route)
    const link = `${pitwall}/p/${encodeURIComponent(route.projectId)}`
    if (!target) {
      return page(res, 503, `${esc(route.serviceName)} isn’t running`, `<p>Start it in Pitwall, then reload this page.</p><a href="${link}">Open in Pitwall</a>`)
    }

    const out = http.request(
      { host: target.host, port: target.port, method: req.method, path: req.url, headers: forwardHeaders(req, target) },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.statusMessage, responseHeaders(req, upstreamRes, domain, target.port))
        upstreamRes.pipe(res)
      },
    )
    out.on('error', () => {
      if (res.headersSent) return res.destroy()
      // Usually still starting: the page reloads itself until it answers.
      page(res, 502, `${esc(route.serviceName)} isn’t answering yet`, `<p>It may still be starting. This page retries by itself.</p><a href="${link}">Open in Pitwall</a>`, true)
    })
    req.pipe(out)
  },

  upgrade(req, socket, head) {
    const domain = cloudDomain()
    const route = domain && signedIn(req) ? routeForHost(hostOf(req)) : null
    const target = route ? upstream(route) : null
    if (!target) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
      return
    }
    const conn = net.connect(target.port, target.host, () => {
      const headers = forwardHeaders(req, target)
      const lines = [`${req.method} ${req.url} HTTP/1.1`]
      for (const [k, v] of Object.entries(headers)) {
        for (const value of Array.isArray(v) ? v : v === undefined ? [] : [v]) lines.push(`${k}: ${value}`)
      }
      conn.write(lines.join('\r\n') + '\r\n\r\n')
      if (head.length) conn.write(head)
      socket.pipe(conn).pipe(socket)
    })
    const close = () => {
      socket.destroy()
      conn.destroy()
    }
    conn.on('error', close)
    socket.on('error', close)
  },
}

/** Start the gateway (once); later calls just swap in the current code. */
export function startGateway() {
  store.__pitwallGatewayHandlers = handlers
  if (store.__pitwallGateway) return
  const server = http.createServer((req, res) => store.__pitwallGatewayHandlers!.request(req, res))
  server.on('upgrade', (req, socket, head) => store.__pitwallGatewayHandlers!.upgrade(req, socket as net.Socket, head))
  server.on('error', (e) => console.error('[pitwall] gateway:', e.message))
  // Only Caddy, on this machine, talks to it.
  server.listen(PORT, '127.0.0.1')
  store.__pitwallGateway = server
}
