# pitwall

A control panel for local development: every project gets a space with its
services (start, stop, live output) and a task inbox.

## Run it

```bash
npm install
npm run dev        # through portless → https://pitwall.localhost
npm run dev:app    # plain Vite, if you don't want portless
```

The first time portless runs it sets up a local certificate and the proxy, and
may ask for your password. Run `npx portless` once in a terminal before starting
services that use portless from inside Pitwall.

## Add your projects

Click **+** in the project rail (or open `/new`), point it at a project folder
and press **Scan folder**. Pitwall reads the folder and suggests how to run
each service:

- npm / pnpm / yarn workspaces, or apps kept in plain subfolders
  (`server/`, `web/`, `mobile/`)
- the framework of each app (Next.js, Vite, TanStack Start, Expo, Express, …)
  and its `dev` / `start` script
- a `docker-compose.yml` / `compose.yaml`
- extra dev scripts such as `worker:dev`, listed but off

Web apps are wrapped in portless (`portless web.myproject npm run dev`) when it
is installed. Expo and scripts that fix their own `--port` are left alone. Edit
anything before you add the project.

Projects are saved to `pitwall.config.json` (git-ignored). To change one later,
open its settings (the gear next to Start all): rename it, move its folder,
edit, add or remove services, scan the folder for new ones, or remove the
project. You can also edit the file by hand. Until it exists, Pitwall shows the sample project from
`pitwall.config.example.json`.

```json
{
  "projects": [
    {
      "id": "guidepal",
      "name": "GuidePal",
      "path": "~/src/guidepal",
      "services": [
        { "id": "server", "name": "Server", "cwd": "server", "command": "portless server.guidepal npm run dev" },
        { "id": "mobile", "name": "Mobile", "cwd": "mobile", "command": "npx expo start" }
      ]
    }
  ]
}
```

## How it works

- `src/server/processes.ts` starts each command in its own process group,
  keeps the last 1,000 lines of output, detects URLs, and marks a non-zero exit
  as a crash.
- `src/server/fns.ts` exposes that to the UI as TanStack Start server
  functions. The page polls them once a second.
- Tasks are stored in `.pitwall/tasks.json` (git-ignored). "Send to tasks" on a
  crashed service turns its last output into a task.

## Not built yet

An AI pass over the scan (reading READMEs and env files), the plan review screen, and email / browser
console intake. They are designed on the canvas and come next.
