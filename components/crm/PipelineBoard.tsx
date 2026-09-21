// OWNER: lane A — server component
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { StageBadge } from '@/components/crm/StageBadge'
import { STAGE_LABEL } from '@/components/crm/constants'
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
    <div className="flex flex-col gap-4 md:flex-row md:overflow-x-auto md:pb-2">
      {columns.map((column) => (
        <div key={column.stage} className="w-full md:w-72 md:flex-shrink-0">
          <div className="mb-2 flex items-center justify-between">
            <StageBadge stage={column.stage} />
            <span className="text-sm font-semibold text-muted">{column.total}</span>
          </div>
          <div className="flex flex-col gap-2">
            {column.items.map((lead) => (
              <Card key={lead.id} padding="sm">
                <Link href={`/leads/${lead.id}`} className="text-sm font-semibold text-ink hover:text-primary-2 hover:underline">
                  {lead.title}
                </Link>
                <p className="mt-1 text-xs text-muted">
                  {fullName(lead.contact.firstName, lead.contact.lastName)}
                </p>
                {lead.value !== null ? (
                  <p className="mt-1 text-xs font-semibold text-ink-2 tabular-nums">{formatMoney(lead.value, lead.currency)}</p>
                ) : null}
              </Card>
            ))}
          </div>
          <Link
            href={`/leads?stage=${column.stage}`}
            className="mt-2 inline-flex min-h-6 items-center text-xs font-semibold text-primary-2 hover:underline"
          >
            ดูทั้งหมดในสถานะ{STAGE_LABEL[column.stage]}
          </Link>
        </div>
      ))}
    </div>
  )
}
