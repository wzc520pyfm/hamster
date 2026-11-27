import { Badge } from '@/components/ui/badge'
import {
  approvalStatusLabel,
  controlStatusLabel,
  taskStatusLabel,
  type Locale,
} from '@/i18n/messages'
import type { ApprovalStatus, ControlStatus, TaskStatus } from '@/lib/api'

function taskTone(status: TaskStatus) {
  switch (status) {
    case 'running':
      return 'info' as const
    case 'waiting_for_approval':
      return 'warn' as const
    case 'failed':
      return 'danger' as const
    case 'cancelled':
      return 'quiet' as const
    case 'succeeded':
      return 'neutral' as const
    default:
      return 'neutral' as const
  }
}

export function TaskStatusLabel({ status, locale }: { status: TaskStatus; locale: Locale }) {
  return (
    <Badge
      tone={taskTone(status)}
      aria-label={taskStatusLabel(status, locale)}
      className="max-w-full whitespace-normal text-left leading-snug"
      data-testid="task-status-label"
      data-status={status}
    >
      {status === 'running' ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-[#2c4f73]" aria-hidden />
          {taskStatusLabel(status, locale)}
        </span>
      ) : (
        taskStatusLabel(status, locale)
      )}
    </Badge>
  )
}

export function ControlStatusLabel({
  status,
  locale,
}: {
  status: ControlStatus
  locale: Locale
}) {
  return (
    <Badge
      tone="info"
      className="max-w-full whitespace-normal"
      data-testid="control-status-label"
      data-status={status}
    >
      {controlStatusLabel(status, locale)}
    </Badge>
  )
}

export function ApprovalStatusLabel({
  status,
  locale,
}: {
  status: ApprovalStatus
  locale: Locale
}) {
  const tone =
    status === 'pending'
      ? 'warn'
      : status === 'approved'
        ? 'info'
        : status === 'denied' || status === 'expired'
          ? 'danger'
          : 'quiet'
  return (
    <Badge
      tone={tone}
      className="max-w-full whitespace-normal text-left leading-snug"
      data-testid="approval-status-label"
      data-status={status}
    >
      {approvalStatusLabel(status, locale)}
    </Badge>
  )
}
