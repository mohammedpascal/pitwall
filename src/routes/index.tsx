import { createFileRoute, redirect } from '@tanstack/react-router'
import { getProjects, getSetup } from '#/server/fns'

export const Route = createFileRoute('/')({
  loader: async () => {
    const [projects, setup] = await Promise.all([getProjects(), getSetup()])
    // A new cloud machine starts on Setup, until you've seen it once.
    if (setup && !setup.seen && !setup.done) throw redirect({ to: '/setup' })
    throw projects[0]
      ? redirect({ to: '/p/$projectId', params: { projectId: projects[0].id } })
      : redirect({ to: '/new' })
  },
})
