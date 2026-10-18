/** Small helpers for Pitwall's plain HTTP endpoints. */

/** The visitor's address: Caddy puts it first in X-Forwarded-For. */
export function clientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local'
}

/** Requests Caddy proxies carry X-Forwarded-For; its own certificate checks don't. */
export const fromThisMachine = (request: Request) => !request.headers.get('x-forwarded-for')

export function redirect(to: string, headers: Record<string, string> = {}) {
  return new Response(null, { status: 303, headers: { location: to, 'cache-control': 'no-store', ...headers } })
}
