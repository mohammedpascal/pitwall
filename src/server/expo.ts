import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { groupCommands } from './processes'

/**
 * Expo only draws its QR code when its output is a terminal (TTY). Pitwall pipes
 * service output, so Expo prints just "Waiting on http://localhost:8081" and no
 * QR. This rebuilds the link Expo's QR would hold (@expo/cli
 * printDevServerInfoAsync), pointed at this Mac's LAN address so a phone can
 * reach it:
 *  - started with --dev-client → <scheme>://expo-development-client/?url=…
 *  - expo-dev-client installed → the "choose an app" page, /_expo/loading
 *  - otherwise                 → exp://<lan-ip>:<port> for Expo Go
 */

export interface ExpoQr {
  url: string
  hint: string
}

function readDeps(cwd: string): Record<string, string> {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    return { ...pkg.dependencies, ...pkg.devDependencies }
  } catch {
    return {}
  }
}

/** This Mac's address on the local network (Wi-Fi first), like Expo's "LAN" host. */
function lanAddress(): string | null {
  const nets = os.networkInterfaces()
  const names = Object.keys(nets).sort((a, b) => (a === 'en0' ? -1 : b === 'en0' ? 1 : 0))
  for (const name of names) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return null
}

/** The app's URL scheme, from the dev server's manifest. */
async function manifestScheme(origin: string): Promise<string | null> {
  try {
    const res = await fetch(origin, {
      headers: { 'expo-platform': 'ios', accept: 'application/expo+json,application/json' },
      signal: AbortSignal.timeout(2000),
    })
    const manifest = (await res.json()) as { extra?: { expoClient?: { scheme?: string | string[] } } }
    const scheme = manifest.extra?.expoClient?.scheme
    return (Array.isArray(scheme) ? scheme[0] : scheme) ?? null
  } catch {
    return null
  }
}

// One answer per run: the key includes the URL and start time.
const cache = new Map<string, ExpoQr | null>()

export async function expoQr(opts: {
  key: string
  command: string
  cwd: string
  url: string | null
  startedAt: number | null
}): Promise<ExpoQr | null> {
  const { key, command, cwd, url, startedAt } = opts
  if (!url) return null
  const cacheKey = `${key}|${url}|${startedAt}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)!

  const deps = readDeps(cwd)
  const commands = groupCommands(key)
  const expoCommand = commands.find((c) => /\bexpo(\.js)?\s+start\b/.test(c))
  if (!('expo' in deps) && !expoCommand && !/\bexpo\s+start\b/.test(command)) {
    cache.set(cacheKey, null)
    return null
  }

  let origin: URL
  try {
    origin = new URL(url)
  } catch {
    return null
  }
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(origin.hostname)) {
    const lan = lanAddress()
    if (lan) origin.hostname = lan
  }
  const base = `${origin.protocol}//${origin.host}`

  let qr: ExpoQr | null
  if (/--dev-client\b/.test(expoCommand ?? command)) {
    const scheme = await manifestScheme(url)
    // Metro may still be starting; try again on the next poll instead of caching a guess.
    if (!scheme) return null
    qr = {
      url: `${scheme}://expo-development-client/?url=${encodeURIComponent(base)}`,
      hint: 'Scan with your phone’s camera to open it in your development build.',
    }
  } else if ('expo-dev-client' in deps) {
    qr = {
      url: `${base}/_expo/loading`,
      hint: 'Scan with your phone, then pick Expo Go or your development build.',
    }
  } else {
    qr = { url: `exp://${origin.host}`, hint: 'Scan with your phone to open it in Expo Go.' }
  }
  cache.set(cacheKey, qr)
  return qr
}
