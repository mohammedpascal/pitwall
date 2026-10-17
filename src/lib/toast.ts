import { useSyncExternalStore } from 'react'

export interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => unknown }
}

let current: Toast | null = null
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** One toast at a time; a new one replaces the last. Undo lives here instead of confirm dialogs. */
export function showToast(text: string, action?: Toast['action'], ms = 6000) {
  clearTimeout(timer)
  current = { id: Date.now(), text, action }
  emit()
  timer = setTimeout(dismissToast, ms)
}

export function dismissToast() {
  clearTimeout(timer)
  current = null
  emit()
}

export function useToast() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
    () => null,
  )
}
