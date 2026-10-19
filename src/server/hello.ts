import fs from 'node:fs'
import path from 'node:path'
import { displayPath, helloSeeded, insertProject, isCloud, loadConfig, markHelloSeeded, projectsDir } from './config'
import { launchAll } from './launch'

/**
 * A new cloud machine starts with one sample project, so there's something to
 * look at and try a task on. Its page explains Pitwall; removing the project
 * removes the tutorial, and it never comes back.
 */

const SERVE_MJS = `// Serves this folder's files. Pitwall gives it PORT; it prints the address so Pitwall finds it.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const root = path.dirname(new URL(import.meta.url).pathname)
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' }
const port = Number(process.env.PORT) || 8080
const host = process.env.HOST || '127.0.0.1'

http
  .createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\\/$/, '/index.html')
    const file = path.join(root, path.normalize(name))
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      return res.end('Not found')
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    fs.createReadStream(file).pipe(res)
  })
  .listen(port, host, () => console.log(\`Hello World on http://\${host}:\${port}\`))
`

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hello World</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>
  :root { --bg: #f7f6f4; --surface: #fff; --ink: #111; --soft: #666; --line: #e2e2e2; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 'Space Grotesk', system-ui, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 72px 20px 64px; }
  .tag { display: inline-block; font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--soft); }
  h1 { font-size: 40px; line-height: 1.1; letter-spacing: -.02em; margin: 8px 0 12px; }
  .lead { font-size: 18px; color: var(--soft); margin: 0 0 36px; }
  section { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 20px 22px; margin-bottom: 14px; }
  h2 { font-size: 17px; margin: 0 0 6px; }
  p { margin: 0; color: var(--soft); }
  b { color: var(--ink); font-weight: 600; }
  code, .try { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 14px; }
  .try { display: block; margin: 12px 0 10px; padding: 10px 12px; border-radius: 10px; background: var(--bg); color: var(--ink); }
</style>
</head>
<body>
<main>
  <span class="tag">Sample project</span>
  <h1>Hello World</h1>
  <p class="lead">This page is a sample project: one HTML file in <code>~/projects/hello-world</code>, run by Pitwall. Use it to see how Pitwall works.</p>

  <section>
    <h2>Try a task</h2>
    <p>In Pitwall, under <b>Needs you</b>, click <b>Add a task</b> and type:</p>
    <span class="try">Make the background light blue and add a footer</span>
    <p>Claude reads it, then choose <b>Do it</b> (or <b>Plan</b> to see the plan first). When it's done, reload this page to see the change.</p>
  </section>

  <section>
    <h2>Add your own project</h2>
    <p>Click <b>+</b> in Pitwall's left rail. Pick one of your <b>GitHub</b> repos, a <b>folder</b> on this server, or start a <b>new</b> empty project and ask Claude to build it.</p>
  </section>

  <section>
    <h2>Done with this one?</h2>
    <p>Open the project's <b>⋯</b> menu and choose <b>Remove project</b>. It won't come back.</p>
  </section>
</main>
</body>
</html>
`

/** Makes, adds and starts the sample project, once, on a cloud machine with no projects yet. */
export async function seedHello() {
  if (!isCloud() || helloSeeded() || loadConfig().length) return
  markHelloSeeded()
  const dir = path.join(projectsDir(), 'hello-world')
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, body] of [
    ['index.html', INDEX_HTML],
    ['serve.mjs', SERVE_MJS],
  ]) {
    const file = path.join(dir, name)
    if (!fs.existsSync(file)) fs.writeFileSync(file, body)
  }
  const project = { id: 'hello-world', name: 'Hello World', path: displayPath(dir), services: [{ id: 'web', name: 'Web', command: 'node serve.mjs' }] }
  insertProject(project)
  await launchAll({ ...project, path: dir })
}
