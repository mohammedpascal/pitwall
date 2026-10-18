import fs from 'node:fs'
import { createFileRoute } from '@tanstack/react-router'
import { filePath } from '#/server/attachments'
import { get } from '#/server/tasks'

/** A task's attached file, for its thumbnail and to open it in a new tab. */
export const Route = createFileRoute('/attachments/$taskId/$file')({
  server: {
    handlers: {
      GET: ({ params }) => {
        const a = get(params.taskId)?.attachments?.find((x) => x.file === params.file)
        const p = a && filePath(params.taskId, a.file)
        if (!a || !p) return new Response('Not found', { status: 404 })
        // Only images and plain text show inline; anything else downloads.
        const inline = /^image\/(png|jpe?g|gif|webp|avif)$/.test(a.type) || a.type === 'text/plain'
        return new Response(fs.readFileSync(p), {
          headers: {
            'content-type': inline ? a.type : 'application/octet-stream',
            'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
            'x-content-type-options': 'nosniff',
            'cache-control': 'private, max-age=3600',
          },
        })
      },
    },
  },
})
