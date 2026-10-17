export function errorMessage(e: unknown) {
  const text = e instanceof Error ? e.message : String(e)
  return text || 'Something went wrong'
}
