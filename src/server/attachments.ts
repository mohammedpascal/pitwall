import fs from 'node:fs'
import path from 'node:path'
import type { Attachment, AttachmentUpload } from './types'

const ROOT = path.join(process.cwd(), '.pitwall', 'attachments')

export const MAX_FILE = 20 * 1024 * 1024
export const MAX_FILES = 10

export const dir = (taskId: string) => path.join(ROOT, path.basename(taskId))

/** The stored file, or null for anything that isn't one of this task's files. */
export function filePath(taskId: string, file: string) {
  const p = path.join(dir(taskId), path.basename(file))
  return fs.existsSync(p) ? p : null
}

/** A file name that's safe on disk and unique within the task. */
function storedName(name: string, taken: Set<string>) {
  const ext = path.extname(name).slice(0, 12)
  const base = path.basename(name, path.extname(name)).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file'
  let file = `${base}${ext}`
  for (let i = 2; taken.has(file); i++) file = `${base}-${i}${ext}`
  taken.add(file)
  return file
}

export function save(taskId: string, uploads: AttachmentUpload[]): Attachment[] {
  if (uploads.length > MAX_FILES) throw new Error(`Attach up to ${MAX_FILES} files`)
  const taken = new Set<string>()
  const files = uploads.map((u) => {
    const data = Buffer.from(u.data, 'base64')
    if (data.length > MAX_FILE) throw new Error(`${u.name} is over 20 MB`)
    return { u, data, file: storedName(u.name, taken) }
  })
  if (!files.length) return []
  fs.mkdirSync(dir(taskId), { recursive: true })
  return files.map(({ u, data, file }) => {
    fs.writeFileSync(path.join(dir(taskId), file), data)
    return { name: u.name, file, type: u.type || 'application/octet-stream', size: data.length }
  })
}
