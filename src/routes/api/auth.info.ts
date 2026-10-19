import { createFileRoute } from '@tanstack/react-router'
import { hasPassword } from '#/server/auth'

/** Open without signing in: tells the login page whether to show a password field. */
export const Route = createFileRoute('/api/auth/info')({
  server: {
    handlers: {
      GET: () => Response.json({ password: hasPassword() }, { headers: { 'cache-control': 'no-store' } }),
    },
  },
})
