import { useEffect, useRef, useState } from 'react'
import type { AttachmentUpload } from '#/server/types'
import { PaperclipIcon, PlusIcon } from './icons'

/** A file picked, pasted or dropped, before it's sent. */
export interface Picked {
  id: number
  file: File
  /** Thumbnail for images. */
  preview: string | null
}

const MAX_FILE = 20 * 1024 * 1024
let nextId = 0

function toUpload(file: File): Promise<AttachmentUpload> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve({ name: file.name, type: file.type, data: String(r.result).split(',')[1] ?? '' })
    r.onerror = () => reject(new Error(`Couldn’t read ${file.name}`))
    r.readAsDataURL(file)
  })
}

const kb = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`

/** Files waiting to go with a message: up to 10, each up to 20 MB. */
export function useAttachments() {
  const [files, setFiles] = useState<Picked[]>([])
  const [problem, setProblem] = useState<string | null>(null)

  // Thumbnails are object URLs; let them go when the files do.
  const urls = useRef(new Set<string>())
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])

  function addFiles(list: FileList | File[]) {
    const incoming = [...list]
    const tooBig = incoming.filter((f) => f.size > MAX_FILE)
    setProblem(
      tooBig.length ? `${tooBig.map((f) => f.name).join(', ')} ${tooBig.length > 1 ? 'are' : 'is'} over 20 MB` : null,
    )
    const picked = incoming
      .filter((f) => f.size <= MAX_FILE)
      .map((file) => {
        const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
        if (preview) urls.current.add(preview)
        // Pasted screenshots are all called image.png; give them a better name.
        const named =
          file.name === 'image.png' || !file.name
            ? new File([file], `screenshot-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.png`, {
                type: file.type,
              })
            : file
        return { id: ++nextId, file: named, preview }
      })
    setFiles((f) => [...f, ...picked].slice(0, 10))
  }

  function forget(p: Picked) {
    if (p.preview) {
      URL.revokeObjectURL(p.preview)
      urls.current.delete(p.preview)
    }
  }

  function removeFile(p: Picked) {
    forget(p)
    setFiles((f) => f.filter((x) => x.id !== p.id))
  }

  function clear() {
    files.forEach(forget)
    setFiles([])
    setProblem(null)
  }

  const uploads = () => Promise.all(files.map((p) => toUpload(p.file)))

  return { files, problem, setProblem, addFiles, removeFile, clear, uploads }
}

/** The round + that opens the file picker. */
export function AttachButton({ onPick }: { onPick: (files: FileList) => void }) {
  const picker = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onPick(e.target.files)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => picker.current?.click()}
        aria-label="Attach files"
        title="Attach files, or paste or drop them here"
        className="flex size-9 items-center justify-center rounded-full border border-line text-ink-soft hover:bg-line-soft hover:text-ink"
      >
        <PlusIcon size={16} />
      </button>
    </>
  )
}

/** What's attached so far, each with a × to take it off. */
export function AttachmentChips({ files, onRemove }: { files: Picked[]; onRemove: (p: Picked) => void }) {
  if (files.length === 0) return null
  return (
    <ul aria-label="Attachments" className="flex flex-wrap gap-2">
      {files.map((p) => (
        <li
          key={p.id}
          className="flex max-w-full items-center gap-2 rounded-lg border border-line bg-bg py-1 pr-1 pl-1"
        >
          {p.preview ? (
            <img src={p.preview} alt="" className="size-8 flex-none rounded object-cover" />
          ) : (
            <span className="flex size-8 flex-none items-center justify-center rounded bg-line-soft text-ink-soft">
              <PaperclipIcon size={14} />
            </span>
          )}
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="max-w-[150px] truncate text-xs font-medium">{p.file.name}</span>
            <span className="text-[11px] text-ink-soft">{kb(p.file.size)}</span>
          </span>
          <button
            type="button"
            onClick={() => onRemove(p)}
            aria-label={`Remove ${p.file.name}`}
            className="flex size-7 flex-none items-center justify-center rounded-md text-ink-soft hover:bg-line-soft hover:text-ink"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}
