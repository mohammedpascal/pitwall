import { useEffect, useRef, useState } from 'react'

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
      srcDoc={html}
      sandbox="allow-same-origin"
      style={{ height }}
      className="block w-full border-0 bg-white"
    />
  )
}
