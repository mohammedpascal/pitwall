import { createFileRoute } from '@tanstack/react-router'
import { newSession, sessionCookie, useLink } from '#/server/auth'
import { cloudDomain } from '#/server/cloud'
import { redirect } from '#/server/request'

/** The link the installer prints (or `pitwall link`): it works once, and signs you in. */
export const Route = createFileRoute('/login/$token')({
  server: {
    handlers: {
      GET: ({ params }) => {
        if (!useLink(params.token)) return redirect('/login?error=link')
        return redirect('/', { 'set-cookie': sessionCookie(cloudDomain(), newSession()) })
      },
    },
  },
})
