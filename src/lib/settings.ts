import { useSyncExternalStore } from 'react'

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
