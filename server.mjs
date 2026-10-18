#!/usr/bin/env node
// Pitwall in production: serves the built app (npm run build) with plain Node.
// Listens on 127.0.0.1:$PORT (3000); Caddy sits in front on a cloud machine.
// Run it from Pitwall's data folder: that's where pitwall.config.json and .pitwall/ live.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const CLIENT = path.join(ROOT, 'dist', 'client')
const { default: app } = await import(path.join(ROOT, 'dist', 'server', 'server.js'))

const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

/** A built file from dist/client, or null. Never anything outside it. */
function staticFile(urlPath) {
  let rel
  try {
    rel = decodeURIComponent(urlPath.split('?')[0])
  } catch {
    return null
  }
  const file = path.join(CLIENT, rel)
  if (!file.startsWith(CLIENT + path.sep)) return null
  try {
    return fs.statSync(file).isFile() ? file : null
  } catch {
    return null
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const file = req.method === 'GET' || req.method === 'HEAD' ? staticFile(req.url ?? '/') : null
    if (file) {
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        // Built assets have content hashes in their names.
        'cache-control': req.url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      })
      if (req.method === 'HEAD') return res.end()
      return fs.createReadStream(file).pipe(res)
    }

    const proto = req.headers['x-forwarded-proto'] ?? 'http'
    const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost'
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) {
      for (const value of Array.isArray(v) ? v : v === undefined ? [] : [v]) headers.append(k, value)
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    const request = new Request(`${proto}://${host}${req.url}`, {
      method: req.method,
      headers,
      ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
    })

    const response = await app.fetch(request)
    const out = {}
    response.headers.forEach((value, key) => {
      if (key !== 'set-cookie') out[key] = value
    })
    const cookies = response.headers.getSetCookie?.() ?? []
    if (cookies.length) out['set-cookie'] = cookies
    res.writeHead(response.status, response.statusText, out)
    if (!response.body || req.method === 'HEAD') return res.end()
    Readable.fromWeb(response.body).pipe(res)
  } catch (e) {
    console.error('[pitwall]', e)
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
    res.end('Pitwall hit an error. See its log.')
  }
})

const port = Number(process.env.PORT) || 3000
const host = process.env.HOST || '127.0.0.1'
server.listen(port, host, async () => {
  console.log(`Pitwall on http://${host}:${port}`)
  // Bring back services left running, and the gateway, without waiting for a visit.
  const res = await app.fetch(new Request(`http://127.0.0.1:${port}/api/boot`, { method: 'POST' }))
  if (!res.ok) console.error('[pitwall] startup failed:', res.status)
})
