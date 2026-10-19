#!/usr/bin/env node
// Print a sign-in link for Pitwall (cloud mode). It works once, for 24 hours.
//   PITWALL_IP=<this server's IP> node scripts/new-link.mjs
// Run it in Pitwall's data folder (where pitwall.config.json lives). The link is on
// pitwall.<domain> once a dev domain is set, else on the IP. Writes the same
// format as src/server/auth.ts.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const LINK_MS = 24 * 3600_000

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

const domain = readJson('pitwall.config.json')?.domain?.trim()
const host = domain ? `pitwall.${domain}` : process.env.PITWALL_IP?.trim()
if (!host) {
  console.error('No dev domain in pitwall.config.json and no PITWALL_IP: nowhere to point the link.')
  process.exit(1)
}

const dir = path.join(process.cwd(), '.pitwall')
const file = path.join(dir, 'auth.json')
const auth = readJson(file) ?? {}
const token = crypto.randomBytes(32).toString('base64url')
const links = (auth.links ?? []).filter((l) => l.expires > Date.now())
links.push({ hash: crypto.createHash('sha256').update(token).digest('hex'), expires: Date.now() + LINK_MS })

fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(
  file,
  JSON.stringify({ ...auth, secret: auth.secret || crypto.randomBytes(32).toString('hex'), links }, null, 2),
  { mode: 0o600 },
)
fs.chmodSync(file, 0o600)
console.log(`https://${host}/login/${token}`)
