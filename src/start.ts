import { createMiddleware, createStart } from '@tanstack/react-start'
import { readCookie, validSession } from '#/server/auth'
import { cloudDomain } from '#/server/cloud'

// Reachable without signing in: the login page and form, and Caddy's certificate check.
// (/api/boot answers only requests from this machine.)
const OPEN = ['/login', '/api/auth/', '/api/caddy/ask', '/api/boot']

/** On a cloud machine every Pitwall page and action needs the login cookie. */
const requireLogin = createMiddleware().server(async ({ next, request }) => {
  if (!cloudDomain()) return next()
  const url = new URL(request.url)
  if (OPEN.some((p) => url.pathname === p || (p.endsWith('/') && url.pathname.startsWith(p)))) return next()
  if (validSession(readCookie(request.headers.get('cookie')))) return next()
  if (request.method === 'GET' && !url.pathname.startsWith('/_serverFn')) {
    const login = `/login?next=${encodeURIComponent(url.pathname + url.search)}`
    return new Response(null, { status: 302, headers: { location: login, 'cache-control': 'no-store' } })
  }
  return new Response('Sign in to Pitwall first', { status: 401 })
})

export const startInstance = createStart(() => ({ requestMiddleware: [requireLogin] }))
