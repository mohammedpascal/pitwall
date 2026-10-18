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

/** Waiting on you first, then what Claude is working on; newest first within each. */
export function byAttention(a: Task, b: Task) {
  const rank = (t: Task) => (STAGE[t.stage].yours ? 0 : 1)
  return rank(a) - rank(b) || seen(b) - seen(a)
}
