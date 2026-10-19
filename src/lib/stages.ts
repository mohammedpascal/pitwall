import type { Task, TaskKind, TaskStage } from '#/server/types'

/** What each stage says on a task, and whether it waits on you. */
export const STAGE: Record<TaskStage, { label: string; working?: boolean; yours?: boolean; action?: string }> = {
  new: { label: 'Reading it…', working: true },
  understanding: { label: 'Reading it…', working: true },
  ready: { label: 'Ready', yours: true, action: 'Plan' },
  planning: { label: 'Planning…', working: true },
  planned: { label: 'Plan ready', yours: true, action: 'Review plan' },
  doing: { label: 'Working on it…', working: true },
  check: { label: 'Done. Check it', yours: true, action: 'Check it' },
  done: { label: 'Done' },
  dismissed: { label: 'Closed' },
}

export const KIND: Record<TaskKind, string> = { bug: 'Bug', change: 'Change', question: 'Question' }

export const isClosed = (t: Task) => t.stage === 'done' || t.stage === 'dismissed'

const seen = (t: Task) => t.lastSeenAt ?? t.createdAt

/** Its stage waits on you, or Claude is asking you for a permission. */
export const waitsOnYou = (t: Task) => !!STAGE[t.stage].yours || !!t.asking

/** What Claude is asking to do, in a few words: "run a command", "fetch a page". */
export function askingLabel(tool: string) {
  if (tool === 'Bash') return 'Claude asks to run a command'
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'Claude asks to use the web'
  if (tool.startsWith('mcp__')) return `Claude asks to use ${tool.split('__')[1] ?? 'a tool'}`
  return `Claude asks to use ${tool}`
}

/** Waiting on you first, then what Claude is working on; newest first within each. */
export function byAttention(a: Task, b: Task) {
  const rank = (t: Task) => (waitsOnYou(t) ? 0 : 1)
  return rank(a) - rank(b) || seen(b) - seen(a)
}
