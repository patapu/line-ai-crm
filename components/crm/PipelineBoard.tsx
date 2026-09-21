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
    <>
      <nav aria-label="สรุปจำนวน lead ตามสถานะ" className="mb-3 md:hidden">
        <ul className="flex flex-wrap gap-2">
          {columns.map((column) => (
            <li key={column.stage}>
              <a
                href={`#stage-${column.stage}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white px-3"
              >
                <StageBadge stage={column.stage} />
                <span className="text-sm font-semibold text-ink-2 tabular-nums">{column.total}</span>
                <span className="sr-only"> รายการ</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div
        role="region"
        aria-label="คอลัมน์สถานะ lead"
        tabIndex={0}
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 md:snap-none md:gap-4"
      >
        {columns.map((column) => (
          <section
            key={column.stage}
            id={`stage-${column.stage}`}
            aria-label={`${STAGE_LABEL[column.stage]} ${column.total} รายการ`}
            className="w-[85%] flex-shrink-0 snap-start scroll-mt-4 md:w-72"
          >
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
              {column.items.length === 0 ? (
                <p className="rounded-card border border-dashed border-muted-2 p-3 text-xs text-muted">
                  ยังไม่มี lead ในสถานะนี้
                </p>
              ) : null}
            </div>
            <Link
              href={`/leads?stage=${column.stage}`}
              className="mt-2 inline-flex min-h-11 items-center text-xs font-semibold text-primary-2 hover:underline md:min-h-0"
            >
              ดูทั้งหมดในสถานะ{STAGE_LABEL[column.stage]}
            </Link>
          </section>
        ))}
      </div>
    </>
  )
}
