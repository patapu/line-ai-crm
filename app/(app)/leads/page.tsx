// OWNER: lane A — Server Component
import type { Metadata } from 'next'
import { getActor } from '@/lib/auth/dal'
import { listCompanyOptions, listLeads, listUsers } from '@/modules/crm/service'
import { queryObject } from '@/modules/crm/repository'
import { LeadListQuery } from '@/lib/contracts/crm'
import { LeadFilters } from '@/components/crm/LeadFilters'
import { LeadTable } from '@/components/crm/LeadTable'
import { Pagination } from '@/components/ui/Pagination'
import { LinkButton } from '@/components/ui/LinkButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'

export const metadata: Metadata = { title: 'รายการ Lead' }

export default async function LeadsPage(props: PageProps<'/leads'>) {
  await getActor()
  const sp = await props.searchParams
  const values = queryObject(sp)
  const parsed = LeadListQuery.safeParse(values)
  const q = parsed.success ? parsed.data : LeadListQuery.parse({})

  const [page, users, companies] = await Promise.all([listLeads(q), listUsers(), listCompanyOptions()])

  const paginationParams: Record<string, string> = { ...values }
  delete paginationParams.page

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        group="CRM"
        module="Leads"
        title="รายการ Lead"
        actions={<LinkButton href="/leads/new">New lead</LinkButton>}
      />
      <LeadFilters values={values} users={users} companies={companies} />
      {page.items.length === 0 ? (
        <EmptyState title="ไม่พบ Lead" description="ลองปรับตัวกรองหรือสร้าง Lead ใหม่" />
      ) : (
        <>
          <LeadTable items={page.items} />
          <Pagination
            page={page.page}
            pageSize={page.pageSize}
            total={page.total}
            basePath="/leads"
            params={paginationParams}
          />
        </>
      )}
    </div>
  )
}
