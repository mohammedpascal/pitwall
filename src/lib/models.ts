/** Which Claude a task runs on. Aliases always mean the latest of each; Default passes no flag at all. */
export type ModelChoice = 'default' | 'fable' | 'opus' | 'sonnet' | 'haiku'

export const MODELS: Record<ModelChoice, { label: string; hint: string; flag: string | null }> = {
  default: { label: 'Default', hint: 'Claude Code’s choice', flag: null },
  fable: { label: 'Fable', hint: 'The most capable', flag: 'fable' },
  opus: { label: 'Opus', hint: 'Strong, for hard tasks', flag: 'opus' },
  sonnet: { label: 'Sonnet', hint: 'Fast and capable', flag: 'sonnet' },
  haiku: { label: 'Haiku', hint: 'Fastest, for small tasks', flag: 'haiku' },
}

export const isModel = (m: unknown): m is ModelChoice => typeof m === 'string' && m in MODELS
