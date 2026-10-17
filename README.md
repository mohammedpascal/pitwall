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

## Open a project

Click **+** in the project rail, type a project folder and press **Open**.
Pitwall finds the apps inside and starts them; there is nothing to configure.
It understands:

- npm / pnpm / yarn / bun workspaces, or apps kept in plain subfolders
  (`server/`, `web/`, `mobile/`)
- each app's framework (Next.js, Vite, TanStack Start, Expo, Express, …) and
  its `dev` / `start` script
- a `docker-compose.yml` / `compose.yaml`

Web apps run through portless (`portless web.myproject npm run dev`) when it is
installed. Expo and scripts that set their own `--port` are left alone. If the
folder has nothing to run, Pitwall asks for the one command that starts it.

Extra long-running scripts such as `worker:dev` aren't started; they show up as
**Also in this folder** under the services, one click to add. New apps that
appear in the folder later show up there too.

To try it without a real project, open `examples/sample-project` and add
`node api.mjs` as its command.

## Day to day

- **Start all** in the header starts everything that isn't running (and
  restarts crashed services); it turns into **Stop all** once all are up.
  Start, stop or restart one service from its **⋯** menu.
- Click a service to see its output. Expo apps show a QR code there to open
  the app on your phone (Expo only prints its own QR in an interactive terminal).
- Expo apps get a free port automatically (8081, or the next free one) via
  `RCT_METRO_PORT`, so `expo start` never stops to ask "Use port 8082
  instead?". No wrapper script or `--port` needed; a command that sets its own
  `--port` is left alone.
- When a service crashes it lands in **Needs you** on its own, with the error
  and its output. The same error again bumps a counter (×3) instead of adding
  another task. Mark it **Done** when it's fixed.
- Each service's **⋯** menu: Edit command, Rename, Remove service.
- The project's **⋯** menu: Rename, Change folder, Remove project.
- Removing anything shows an **Undo** for a few seconds instead of asking first.
- Services you leave running start again the next time Pitwall starts.

Everything is stored in `pitwall.config.json` and `.pitwall/` (both
git-ignored). You can edit the config by hand too:

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
  keeps the last 1,000 lines of output, detects URLs, marks a non-zero exit as
  a crash, and remembers what's running in `.pitwall/running.json`.
- `src/server/lifecycle.ts` turns crashes into tasks and restarts remembered
  services. It's server-only on purpose: code at the top level of `fns.ts`
  would be shipped to the browser.
- `src/server/scan.ts` reads a folder and proposes services.
- `src/server/fns.ts` exposes all of it to the UI as TanStack Start server
  functions. The page polls once a second.
- Tasks live in `.pitwall/tasks.json`.

## Not built yet

Plan review for tasks (an agent checks a task and proposes a plan for you to
approve), and email / browser-console intake. They're designed on the canvas
and come next.
