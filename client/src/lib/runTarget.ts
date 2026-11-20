import type { TaskDetail } from '@/lib/api'
import { getCopy, type Locale } from '@/i18n/messages'

/** Stable execution-target ids (design: control plane vs isolated desktop, never the host). */
export const RUN_TARGET_CONTROL_PLANE = 'target_control_plane'
export const RUN_TARGET_ISOLATED_DESKTOP = 'target_isolated_desktop'

/**
 * Must-fix 4: not_started ≠ unavailable.
 * Only unavailable blocks composer dispatch; not_started may send (issues start approval).
 */
export function canDispatchToIsolated(state: string): boolean {
  return state === 'ok' || state === 'not_started'
}

/** `Use the control plane instead` only for tasks that have not started. */
export function mayUseControlPlaneInstead(status: string): boolean {
  return status === 'queued'
}

export type TaskRunState =
  | 'ok'
  | 'unavailable'
  | 'start_failed'
  | 'stopped'
  | 'pending_approval'
  | 'failed'
  | 'cancelled'

/**
 * Execution-target state for a task, mirroring the control-plane decision helper.
 * Container-state sentences are exclusive to this surface and never reuse task
 * lifecycle words (Failed / Succeeded / Denied / Refresh failed / Can't reach).
 */
export function taskRunState(task: TaskDetail | null | undefined): TaskRunState {
  const targetId = task?.targetId ?? RUN_TARGET_CONTROL_PLANE
  if (targetId !== RUN_TARGET_ISOLATED_DESKTOP) {
    if (!task) return 'unavailable'
    return task.status === 'failed' || task.status === 'cancelled' ? task.status : 'ok'
  }
  if (!task) return 'unavailable'
  switch (task.status) {
    case 'queued': {
      const pendingCreate = (task.approvals ?? []).some(
        (a) => a.action === 'create_isolated_desktop' && a.status === 'pending',
      )
      return pendingCreate ? 'pending_approval' : 'start_failed'
    }
    case 'waiting_for_approval':
      return 'pending_approval'
    case 'running':
      return 'ok'
    case 'failed':
      // Mid-run container stop => task Failed with a known reason, never Succeeded.
      return 'stopped'
    case 'succeeded':
      return 'ok'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'unavailable'
  }
}

/** Human-readable run-on label for a task / ticket, in the active locale. */
export function taskRunTargetLabel(
  taskOrTargetId: { targetId?: string | null } | string | null | undefined,
  locale: Locale,
): string {
  const t = getCopy(locale)
  const targetId =
    typeof taskOrTargetId === 'string'
      ? taskOrTargetId
      : taskOrTargetId?.targetId ?? RUN_TARGET_CONTROL_PLANE
  if (targetId === RUN_TARGET_ISOLATED_DESKTOP) return t.isolatedDesktop
  if (targetId === RUN_TARGET_CONTROL_PLANE) return `${t.controlPlane} · ${t.controlPlaneDefault}`
  return t.controlPlane
}

/** Run-on label for an approval ticket (target comes from the ticket params). */
export function approvalRunTargetLabel(
  approval: { params?: Record<string, unknown> | null } | null | undefined,
  locale: Locale,
): string {
  const t = getCopy(locale)
  const rawTarget = approval?.params?.targetId
  const targetId = typeof rawTarget === 'string' && rawTarget.trim() ? rawTarget.trim() : RUN_TARGET_CONTROL_PLANE
  if (targetId === RUN_TARGET_ISOLATED_DESKTOP) return t.isolatedDesktop
  if (targetId === RUN_TARGET_CONTROL_PLANE) return `${t.controlPlane} · ${t.controlPlaneDefault}`
  return t.controlPlane
}
