/**
 * Parse the hamster-worker session header.
 * Fields are separate: taskId, conversationId, targetId, title (title last before ]).
 * Do not let title=([^\]]+) swallow targetId=.
 */

export type WorkerHeader = {
  taskId: string
  conversationId: string
  targetId: string
  title: string
  runtimeSessionId: string
}

const DEFAULT_TITLE = 'Weekly metrics dashboard'
const DEFAULT_TARGET = 'target_control_plane'

export function parseWorkerHeader(
  headerLine: string | undefined | null,
  runtimeSessionId = '',
): WorkerHeader {
  const line = typeof headerLine === 'string' ? headerLine : ''
  const taskId = line.match(/\btaskId=(\S+)/)?.[1] ?? ''
  const conversationId = line.match(/\bconversationId=(\S+)/)?.[1] ?? ''
  const targetId = (line.match(/\btargetId=(\S+)/)?.[1] ?? DEFAULT_TARGET).trim()
  // title is last before ] so it cannot swallow targetId= / conversationId=
  const title = (line.match(/\btitle=([^\]]+)/)?.[1] ?? DEFAULT_TITLE).trim()
  return {
    taskId,
    conversationId,
    targetId,
    title,
    runtimeSessionId: runtimeSessionId || '',
  }
}

export function findWorkerHeaderLine(userMessages: string[]): string | undefined {
  return userMessages.find((m) => m.startsWith('[hamster-worker'))
}
