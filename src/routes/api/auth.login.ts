import { createFileRoute } from '@tanstack/react-router'
import { checkPassword, newSession, recordFailure, safeNext, sessionCookie, tooManyAttempts } from '#/server/auth'
import { cloudDomain } from '#/server/cloud'
import { clientIp, redirect } from '#/server/request'

/** The login form posts here; a right password sets the cookie for Pitwall and every app. */
export const Route = createFileRoute('/api/auth/login')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const domain = cloudDomain()
        if (!domain) return redirect('/')
        const form = await request.formData()
        const next = safeNext(String(form.get('next') ?? ''), domain)
        const back = (error: string) => redirect(`/login?error=${error}&next=${encodeURIComponent(next)}`)
        const ip = clientIp(request)
        if (tooManyAttempts(ip)) return back('wait')
        if (!checkPassword(String(form.get('password') ?? ''))) {
          recordFailure(ip)
          return back('wrong')
        }
        return redirect(next, { 'set-cookie': sessionCookie(domain, newSession()) })
      },
    },
  },
})
