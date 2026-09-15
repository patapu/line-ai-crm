// OWNER: lane A — server component
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { StageBadge } from '@/components/crm/StageBadge'
import { formatMoney, fullName } from '@/components/ui/format'
import type { LeadStage } from '@/lib/generated/prisma/client'
import type { LeadListItem } from '@/modules/crm/types'

export interface PipelineColumn {
  stage: LeadStage
  total: number
  items: LeadListItem[]
}

export interface PipelineBoardProps {
  columns: PipelineColumn[]
}

export function PipelineBoard({ columns }: PipelineBoardProps) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {columns.map((column) => (
        <div key={column.stage} className="w-72 flex-shrink-0">
          <div className="mb-2 flex items-center justify-between">
            <StageBadge stage={column.stage} />
            <span className="text-sm text-slate-500">{column.total}</span>
          </div>
          <div className="flex flex-col gap-2">
            {column.items.map((lead) => (
              <Card key={lead.id} className="p-3">
                <Link href={`/leads/${lead.id}`} className="text-sm font-medium text-slate-900 hover:underline">
                  {lead.title}
                </Link>
                <p className="mt-1 text-xs text-slate-500">
                  {fullName(lead.contact.firstName, lead.contact.lastName)}
                </p>
                {lead.value !== null ? (
                  <p className="mt-1 text-xs text-slate-600">{formatMoney(lead.value, lead.currency)}</p>
                ) : null}
              </Card>
            ))}
          </div>
          <Link
            href={`/leads?stage=${column.stage}`}
            className="mt-2 inline-block text-xs text-slate-500 hover:underline"
          >
            View all
          </Link>
        </div>
      ))}
    </div>
  )
}
