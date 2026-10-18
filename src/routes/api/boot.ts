import { createFileRoute } from '@tanstack/react-router'
import { startLifecycle } from '#/server/lifecycle'
import { fromThisMachine } from '#/server/request'

/**
 * server.mjs calls this once at startup, so services you left running and the
 * gateway come back after a reboot without anyone opening Pitwall first.
 */
export const Route = createFileRoute('/api/boot')({
  server: {
    handlers: {
      POST: ({ request }) => {
        if (!fromThisMachine(request)) return new Response(null, { status: 404 })
        startLifecycle()
        return new Response(null, { status: 204 })
      },
    },
  },
})
