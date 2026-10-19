import { createFileRoute } from '@tanstack/react-router'
import { checkPassword, newSession, recordFailure, sessionCookie, tooManyAttempts } from '#/server/auth'
import { cloudDomain } from '#/server/cloud'
import { clientIp, redirect } from '#/server/request'

/** The login form posts here; the right password sets the cookie for Pitwall and every app. */
export const Route = createFileRoute('/api/auth/login')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData()
        const ip = clientIp(request)
        if (tooManyAttempts(ip)) return redirect('/login?error=wait')
        if (!checkPassword(String(form.get('password') ?? ''))) {
          recordFailure(ip)
          return redirect('/login?error=wrong')
        }
        return redirect('/', { 'set-cookie': sessionCookie(cloudDomain(), newSession()) })
      },
    },
  },
})
