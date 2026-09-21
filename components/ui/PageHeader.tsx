// OWNER: lane A
//
// Server-safe presentational header for list pages: eyebrow (group / module)
// + Thai h1 title, with optional right-aligned actions.

import type { ReactNode } from 'react'

export interface PageHeaderProps {
  group: string
  module: string
  title: string
  actions?: ReactNode
}

export function PageHeader({ group, module, title, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-muted">
          {group} <span className="text-accent-ink">{module}</span>
        </p>
        <h1 className="text-xl font-bold text-primary-2">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
