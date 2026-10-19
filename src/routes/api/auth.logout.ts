import { createFileRoute } from '@tanstack/react-router'
import { sessionCookie } from '#/server/auth'
import { cloudDomain } from '#/server/cloud'
import { redirect } from '#/server/request'

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: {
      POST: () => redirect('/login', { 'set-cookie': sessionCookie(cloudDomain(), null) }),
    },
  },
})
