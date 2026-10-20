import { useSyncExternalStore } from 'react'

/** A task's error when Claude isn't signed in here; the task offers Settings for it. */
export const CLAUDE_SIGNED_OUT = 'Claude isn’t signed in on this machine.'

let open = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Settings opens over whatever page you're on, from anywhere that offers it. */
export function openSettings() {
  open = true
  emit()
}

export function closeSettings() {
  open = false
  emit()
}

export function useSettingsOpen() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => open,
    () => false,
  )
}
