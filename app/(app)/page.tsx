// OWNER: lane A — Server Component (pipeline board)
import type { Metadata } from 'next'
import { getActor } from '@/lib/auth/dal'
import { listLeads } from '@/modules/crm/service'
import { PipelineBoard } from '@/components/crm/PipelineBoard'
import { PageHeader } from '@/components/ui/PageHeader'
import { STAGES } from '@/components/crm/constants'

export const metadata: Metadata = { title: 'ภาพรวม Pipeline' }

export default async function PipelinePage() {
  await getActor()

  const pages = await Promise.all(
    STAGES.map((stage) => listLeads({ page: 1, pageSize: 20, stage, sort: 'updatedAt', dir: 'desc' })),
  )

  const columns = STAGES.map((stage, index) => ({
    stage,
    total: pages[index].total,
    items: pages[index].items,
  }))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader group="CRM" module="Pipeline" title="ภาพรวม Pipeline" />
      <PipelineBoard columns={columns} />
    </div>
  )
}
