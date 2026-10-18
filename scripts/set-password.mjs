#!/usr/bin/env node
// Set Pitwall's login password (cloud mode) and print it once.
//   node scripts/set-password.mjs            generate a new 32-character password
//   node scripts/set-password.mjs <password> use this one
// Run it in Pitwall's data folder (where pitwall.config.json lives).
// A new password also signs everyone out: the cookie secret is replaced.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

function generate(length = 32) {
  let out = ''
  while (out.length < length) {
    const byte = crypto.randomBytes(1)[0]
    // Skip bytes that would bias the pick.
    if (byte < 256 - (256 % ALPHABET.length)) out += ALPHABET[byte % ALPHABET.length]
  }
  return out
}

const password = process.argv[2] || generate()
if (password.length < 12) {
  console.error('Use at least 12 characters.')
  process.exit(1)
}

const salt = crypto.randomBytes(16)
const hash = crypto.scryptSync(password, salt, 64)
const dir = path.join(process.cwd(), '.pitwall')
fs.mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'auth.json')
fs.writeFileSync(
  file,
  JSON.stringify({ hash: `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`, secret: crypto.randomBytes(32).toString('hex') }, null, 2),
  { mode: 0o600 },
)
fs.chmodSync(file, 0o600)
console.log(password)
