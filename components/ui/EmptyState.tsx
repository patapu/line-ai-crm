// OWNER: lane A
import type { ReactNode } from 'react'

export interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-muted-2 bg-white p-10 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description ? <p className="text-sm text-muted">{description}</p> : null}
      {action}
    </div>
  )
}
