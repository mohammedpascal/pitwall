import { createFileRoute } from '@tanstack/react-router'
import { cloudDomain, pitwallHost, routeForHost } from '#/server/cloud'
import { fromThisMachine } from '#/server/request'

/**
 * Caddy asks before getting a certificate for a name ("on-demand TLS").
 * Only Pitwall's own name and configured services get one, so nobody can make
 * it request certificates for made-up names.
 */
export const Route = createFileRoute('/api/caddy/ask')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const domain = cloudDomain()
        const name = (new URL(request.url).searchParams.get('domain') ?? '').toLowerCase()
        const known = !!domain && (name === pitwallHost(domain) || !!routeForHost(name))
        return new Response(null, { status: fromThisMachine(request) && known ? 200 : 404 })
      },
    },
  },
})
