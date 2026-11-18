import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  // Default nowrap for short lifecycle/control badges. Long freshness copy
  // overrides with whitespace-normal so words are never clipped or ellipsized.
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-[var(--color-border)] bg-[var(--color-muted)] text-[var(--color-foreground)]',
        info: 'border-[#c5d4e4] bg-[#edf3f9] text-[#2c4f73]',
        warn: 'border-[#e2d3b3] bg-[#f8f1e4] text-[#6b5428]',
        danger: 'border-[#e2c4c4] bg-[#f8ecec] text-[#8b3a3a]',
        quiet: 'border-[var(--color-border)] bg-transparent text-[var(--color-muted-foreground)]',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}
