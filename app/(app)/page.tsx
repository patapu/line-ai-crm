// OWNER: lane A — Server Component (pipeline board)
import { getActor } from '@/lib/auth/dal'
import { listLeads } from '@/modules/crm/service'
import { PipelineBoard } from '@/components/crm/PipelineBoard'
import { STAGES } from '@/components/crm/constants'

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
      <h1 className="text-lg font-semibold text-slate-900">Pipeline</h1>
      <PipelineBoard columns={columns} />
    </div>
  )
}
