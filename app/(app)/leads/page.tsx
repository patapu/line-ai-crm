// OWNER: lane A — Server Component
import { getActor } from '@/lib/auth/dal'
import { listCompanyOptions, listLeads, listUsers } from '@/modules/crm/service'
import { queryObject } from '@/modules/crm/repository'
import { LeadListQuery } from '@/lib/contracts/crm'
import { LeadFilters } from '@/components/crm/LeadFilters'
import { LeadTable } from '@/components/crm/LeadTable'
import { Pagination } from '@/components/ui/Pagination'
import { LinkButton } from '@/components/ui/LinkButton'
import { EmptyState } from '@/components/ui/EmptyState'

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
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Leads</h1>
        <LinkButton href="/leads/new">New lead</LinkButton>
      </div>
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
