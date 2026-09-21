// OWNER: lane A
import type { HTMLAttributes } from 'react'
import { cn } from '@/components/ui/cn'

export type CardPadding = 'sm' | 'md'

const CARD_PADDING_CLASS: Record<CardPadding, string> = {
  sm: 'p-3',
  md: 'p-4',
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding
}

export function Card({ className, padding = 'md', ...props }: CardProps) {
  return (
    <div
      className={cn('rounded-card border border-line bg-white', CARD_PADDING_CLASS[padding], className)}
      {...props}
    />
  )
}
