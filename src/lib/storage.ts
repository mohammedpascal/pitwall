/** This browser's memory for small view choices; fine when storage is blocked, it just isn't remembered. */
export function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: works for this visit only */
  }
}
