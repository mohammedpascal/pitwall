import { useEffect, useRef, useState } from 'react'

// Pitwall's own styles for every plan. The task around it decides the outer spacing: drop the page's
// own margin, padding and frame, and those of a single wrapper. Its title matches the task's (text-xl).
// Before / After are a label with a line, then the mockup, side by side when there's room; older plans
// that drew them as cards lose the card.
const HOST_CSS = `<style>
html,body{margin:0!important;padding:0!important;background:transparent!important}
body>:only-child{margin-left:0!important;margin-right:0!important;padding-left:0!important;padding-right:0!important;padding-top:0!important;max-width:none!important;border:0!important;box-shadow:none!important;background:transparent!important}
h1{font-size:20px!important;line-height:1.375!important;font-weight:600!important;letter-spacing:-0.01em!important;margin-top:0!important}
.ba{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:28px}
.before,.after{border:0!important;border-radius:0!important;background:none!important;box-shadow:none!important;padding:0!important}
.before>h3:first-child,.after>h3:first-child{display:flex;align-items:center;gap:10px;margin:0 0 14px;font-size:12px;font-weight:600}
.before>h3:first-child::after,.after>h3:first-child::after{content:"";flex:1;height:1px;background:#e5e5e5}
.before>h3>span{padding:2px 10px;border-radius:999px;background:#fbeceb;color:#a3312a}
.after>h3>span{padding:2px 10px;border-radius:999px;background:#e9f5ec;color:#2b7a45}
</style>`
// In the head, so a page wrapper stays the body's only child.
const flat = (html: string) => (/<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${HOST_CSS}</head>`) : HOST_CSS + html)

/**
 * Claude's plan page at its own full height, so the page scrolls instead of a
 * slot inside it. Sandboxed without scripts: the plan can't run anything, and
 * allow-same-origin only lets Pitwall measure it.
 */
export function PlanFrame({ title, html }: { title: string; html: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(240)

  useEffect(() => {
    const el = frame.current
    if (!el) return
    let watch: ResizeObserver | null = null
    const fit = () => {
      const doc = el.contentDocument
      if (doc?.documentElement) setHeight(Math.max(120, doc.documentElement.scrollHeight))
    }
    const loaded = () => {
      fit()
      watch?.disconnect()
      // Re-measure as the width reflows it or its images arrive.
      const body = el.contentDocument?.body
      if (body) {
        watch = new ResizeObserver(fit)
        watch.observe(body)
      }
    }
    el.addEventListener('load', loaded)
    return () => {
      el.removeEventListener('load', loaded)
      watch?.disconnect()
    }
  }, [html])

  return (
    <iframe
      ref={frame}
      title={title}
      srcDoc={flat(html)}
      sandbox="allow-same-origin"
      style={{ height }}
      className="block w-full border-0 bg-transparent"
    />
  )
}
