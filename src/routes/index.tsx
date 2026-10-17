import { createFileRoute, redirect } from '@tanstack/react-router'
import { getProjects } from '#/server/fns'

export const Route = createFileRoute('/')({
  loader: async () => {
    const projects = await getProjects()
    throw projects[0]
      ? redirect({ to: '/p/$projectId', params: { projectId: projects[0].id } })
      : redirect({ to: '/new' })
  },
})
