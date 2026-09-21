// OWNER: lane A
import type { HTMLAttributes } from 'react'
import { cn } from '@/components/ui/cn'

export type BadgeTone = 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'violet' | 'accent'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

const TONE_CLASS: Record<BadgeTone, string> = {
  gray: 'bg-neutral-soft text-ink-2',
  blue: 'bg-primary-soft text-primary',
  amber: 'bg-accent-soft text-accent-ink',
  green: 'bg-success-soft text-success',
  red: 'bg-danger-soft text-danger',
  violet: 'bg-violet-100 text-violet-700',
  accent: 'bg-accent text-ink',
}

export function Badge({ tone = 'gray', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        TONE_CLASS[tone],
        className,
      )}
      {...props}
    />
  )
}
