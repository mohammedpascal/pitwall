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
- Web apps show a live preview of the page above their output, with an
  address bar (type `/notes`, a full URL, or clear it for the home page; the
  page you were on is remembered), Reload, open in a new tab, and Hide. Apps that forbid framing (`X-Frame-Options`, CSP
  `frame-ancestors`) just get the open-in-tab link. Logins that rely on
  third-party cookies may need the new tab.
- Expo apps get a free port automatically (8081, or the next free one) via
  `RCT_METRO_PORT`, so `expo start` never stops to ask "Use port 8082
  instead?". No wrapper script or `--port` needed; a command that sets its own
  `--port` is left alone.
- When a service crashes it lands in **Needs you** on its own, with the error
  and its output. The same error again bumps a counter (×3) instead of adding
  another task.

## Tasks

Crashes and tasks you add go to **Needs you**, and Claude Code (`claude`, run
in the project's folder) takes it from there. Attach files to a task with the
paperclip, or paste a screenshot or drop files into the box; Claude reads them
too (up to 10 files, 20 MB each, kept in `.pitwall/attachments/`). You only
make three decisions:

1. **It reads each task as it arrives:** a clear title, Bug / Change /
   Question, and a short summary. Duplicates and noise are closed on their
   own; they're under **Done** with the reason, and **Reopen** brings them back.
2. **Plan.** Optionally steer it ("keep it minimal"). The plan is a page in
   the main panel: the problem, the screen before and after, the steps, the
   files and the risks. Type what should change and **Revise** for a new
   version; earlier versions stay a click away.
3. **Do it.** Claude makes the change (it can edit files, not run commands);
   you see its output and the changed files. Then **Looks good**, or
   **Not right** with what's wrong, which revises the plan.

To carry on from a finished task, open it (it stays open after **Looks good**)
and type in **Follow up on this…**: that starts a new task from a copy of its
Claude conversation, so the context comes along. The two link to each other.

A fixed crash restarts its service and closes itself once it runs cleanly.
The list shows what waits on you first; everything else is one status line.
Tasks belong to their project. Other projects show how many wait on you as a
badge on their button in the left rail, and the tab title shows the total, e.g.
`(3) younote · Pitwall`.
Reading and planning never change the project. Plans are kept in
`.pitwall/plans/`, and each task keeps one Claude conversation throughout.
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

## Run it in the cloud

Pitwall can run on a cloud machine (Ubuntu or Debian, with ports 80 and 443
free), so you can work from anywhere:

```sh
curl -fsSL https://raw.githubusercontent.com/__PITWALL_REPO__/main/install.sh | sudo bash
```

It asks for a dev domain, say `dev.example.com`, and shows the one DNS record
to add where that domain is managed:

```
*.dev.example.com   A   <the server's IP>
```

Then:

- Pitwall is at `https://pitwall.dev.example.com`, and each service at
  `https://<project>-<service>.dev.example.com` (e.g. `guidepal-server`).
  Certificates are issued automatically by Caddy, only for those names.
- One password, generated by the installer and shown once, signs you in to
  Pitwall and every app (`sudo pitwall reset-password` for a new one).
- There's no portless on the server: Pitwall picks each service's port and
  routes to it. Vite and similar get `--port`/`--host` added for them.
- Previews always work there; Pitwall's preview frame is allowed even for apps
  that forbid framing, without changing the apps.
- Only SSH, 80 and 443 are open. Dev servers listen on 127.0.0.1.
- Projects live in `/home/pitwall/projects`; Pitwall's data in `/var/lib/pitwall`.
- `pitwall logs | restart | status | update`. Running the installer again
  updates Pitwall and keeps everything.

Expo apps run there too, but phones can't reach them through the login yet.

To publish a release the installer can download, push a tag like `v0.1.0`
(see `.github/workflows/release.yml`).

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
