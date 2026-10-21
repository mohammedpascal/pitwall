# pitwall

Pitwall is a development environment for running all your projects on your own
machine or a cloud server: connect GitHub and it checks out your repos, finds
their services and starts them with live previews and output, gives each
service its own HTTPS subdomain automatically (reachable from anywhere on a
cloud server), and turns crashes and your own tasks into work Claude
clarifies, plans (with a before/after view of the change) and then makes.

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

Click the dashed **+** at the end of the project strip and pick where it comes from:

- **GitHub**: your repos, most recently pushed first. One click clones it into
  the projects folder and opens it (a repo that's already there just opens).
- **New**: give it a name, and you get an empty project (a folder with git) for
  Claude to build in. Pitwall offers to run the app once one appears.
- **Folder**: a folder already on this machine (or paste a git URL).

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
3. **Do it.** Claude makes the change; you see its output and the changed files. Then **Looks good**, or
   **Not right** with what's wrong, which revises the plan.

Claude edits files on its own. Anything else that needs permission, such as
running a command or fetching a page, pauses the task in **Needs you** with
what it wants to do: **Allow**, **Always allow in this project** (saved as a
Claude Code rule in the project's `.claude/settings.local.json`) or **Deny**.
A task Claude couldn't finish because of a Deny goes back a step instead of
saying it's done.

Pick which Claude does a task with the model picker next to the mode when you
add it: **Default** (Claude Code's choice), Fable, Opus, Sonnet or Haiku. The
picker remembers your last choice, follow-ups start on their task's model, and
the model shown on an open task can be changed for its next steps.

### Claude's tools

Each project's **⋯ → Claude's tools** shows what Claude can use there: its MCP
servers (this project's, the repo's `.mcp.json`, everyone's, your claude.ai
connectors and plugins) with whether each connects, and its skills (the repo's
`.claude/skills/` and your own `~/.claude/skills/`). Only names, hosts and
statuses are shown, never commands, headers or keys. **Add a server** takes a
URL or a command, plus headers or environment lines; it's added for this
project on this machine only (Claude Code's local scope), so keys never end up
in the repo. **Write a skill** asks Claude to write one as a task.

Claude uses skills on its own when a task fits. To run one yourself, start a
task with `/`: the box suggests skills as you type, and `/deploy staging`
runs the deploy skill with "staging", without rewording the task.

To carry on from a finished task, open it (it stays open after **Looks good**)
and type in **Follow up on this…**: that starts a new task from a copy of its
Claude conversation, so the context comes along. The two link to each other.

A fixed crash restarts its service and closes itself once it runs cleanly.
The list shows what waits on you first; everything else is one status line.
Tasks belong to their project. Projects sit in a strip of chips at the top,
each with a green dot while something runs and a badge with how many wait on
you; the ones that need you come first. The tab title shows the total, e.g.
`(3) younote · Pitwall`.
Reading and planning never change the project. Plans are kept in
`.pitwall/plans/`, and each task keeps one Claude conversation throughout.
- Each service's **⋯** menu: Edit command, Rename, Remove service.
- The project's **⋯** menu: Rename, Change folder, Remove project.
- Removing anything shows an **Undo** for a few seconds instead of asking first.
- Services you leave running start again the next time Pitwall starts.
- A project from git shows its branch under its name, and what there is to
  sync: "2 changed files · 3 new on GitHub". One button does it, labelled
  **Push**, **Pull** or **Sync**: it commits your changes (named after the
  tasks you finished), pulls with rebase and pushes. Nothing is pushed or
  pulled until you press it. If GitHub changed the same lines, nothing is
  lost: the rebase is undone and a "Merge GitHub's changes" task appears.

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
curl -fsSL https://raw.githubusercontent.com/mohammedpascal/pitwall/main/install.sh | sudo bash
```

It asks nothing, and ends with a link that signs you in:

```
Open  https://203.0.113.7/login/k3J9…
```

The link works once, for 24 hours (`sudo pitwall link` prints a new one).
It opens **Setup**, where you sign the server in to Claude (for tasks) and
GitHub (for cloning, `git push` and pull requests), and give it a dev domain.
Each is optional; later they're in **Settings**, in the top **…** menu.

It starts with a **Hello World** project, a static page that shows how
Pitwall works: try a task on it, then remove it from its **⋯** menu.

- Until it has a domain, Pitwall is at the server's IP, with a certificate for
  the IP. Tasks, Claude and GitHub all work; apps can't be opened in the
  browser yet.
- For a domain, say `dev.example.com`, Setup shows the one DNS record to add
  where it's managed (`*.dev.example.com A <the server's IP>`) and moves you to
  `https://pitwall.dev.example.com`, still signed in, once it points there.
  Each service is then at `https://<project>-<service>.dev.example.com` (e.g.
  `guidepal-server`). Certificates are issued automatically by Caddy, only for
  those names. `PITWALL_DOMAIN=dev.example.com` sets it at install time instead.
- One sign-in covers Pitwall and every app. To sign in from other devices,
  set a password in Setup; `sudo pitwall link` always works too.
- There's no portless on the server: Pitwall picks each service's port and
  routes to it. Vite and similar get `--port`/`--host` added for them.
- Previews always work there; Pitwall's preview frame is allowed even for apps
  that forbid framing, without changing the apps.
- Only SSH, 80 and 443 are open. Dev servers listen on 127.0.0.1.
- Signing in to GitHub also sets the git name and email from your account.
  (`sudo pitwall sign-in` signs in to Claude and GitHub over SSH instead.)
- Paste a GitHub URL (or `owner/repo`) where you'd type a folder: Pitwall
  clones it into the projects folder and opens it.
- Installed for your projects: Node, npm, pnpm and yarn (through corepack),
  bun, git, the GitHub CLI, and build tools for native npm modules.
- Projects live in `/home/pitwall/projects`; Pitwall's data in `/var/lib/pitwall`.
  For another projects folder, install with `PITWALL_PROJECTS=/srv/code`
  (`curl … | sudo PITWALL_PROJECTS=/srv/code bash`); running the installer
  again keeps it. Locally, set `PITWALL_PROJECTS` before `npm run dev`.
- `pitwall link | logs | restart | status | update`; `status` also shows where
  Pitwall, your projects and its data are. Running the installer again updates
  Pitwall and keeps everything.
- `sudo pitwall uninstall` removes Pitwall, and asks before deleting the
  `pitwall` user with your projects and sign-ins. Node, Caddy and the other
  tools stay.

Expo apps run there too. Phones can't sign in, so each Expo app also gets a
phone address, `<project>-<service>--<key>.dev.example.com`, which skips the
login: the QR code points there, and Metro is told it (`EXPO_PACKAGER_PROXY_URL`)
so its bundle links use it. The key is random and kept in `.pitwall/auth.json`
(`phoneKey`); a new one (`resetPhoneKey`) stops every old phone link. Without a
domain an Expo app's tab asks you to add one. Restart a running Expo app to
pick up its phone address.

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
