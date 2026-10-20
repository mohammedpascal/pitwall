import { createFileRoute, Link } from '@tanstack/react-router'
import { OpenProject } from '#/components/OpenProject'
import { PageHeader } from '#/components/ui'
import { getGithubRepos, getProjects, getProjectsHome, getSetup } from '#/server/fns'

// The first-run page; once there's a project, the + in the tabs opens the same thing as a dialog.
export const Route = createFileRoute('/new')({
  loader: async () => {
    const [projects, home, setup, github] = await Promise.all([
      getProjects(),
      getProjectsHome(),
      getSetup(),
      getGithubRepos(),
    ])
    return { projects, home, setup, github }
  },
  head: () => ({ meta: [{ title: 'Open a project · Pitwall' }] }),
  component: OpenProjectPage,
})

function OpenProjectPage() {
  const { projects, home, setup, github } = Route.useLoaderData()

  return (
    <div className="min-h-screen bg-bg text-sm text-ink">
      <PageHeader back={projects.length > 0} />

      <main className="mx-auto flex w-full max-w-[620px] flex-col gap-6 px-6 pt-24 pb-16 max-sm:pt-12">
        {setup && !setup.done && (
          <Link
            to="/setup"
            className="self-start rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] font-medium hover:border-ink"
          >
            Finish setting up this machine →
          </Link>
        )}

        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-[-0.015em]">
            {projects.length ? 'Open a project' : 'Open your first project'}
          </h1>
          <p className="text-[15px] leading-relaxed text-ink-soft">
            From GitHub, a new one, or a folder on this machine. Pitwall finds the apps inside and starts them.
          </p>
        </div>

        <OpenProject data={{ home, github }} />
      </main>
    </div>
  )
}
