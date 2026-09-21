// OWNER: lane A — Server Component
import type { Metadata } from 'next'
import { getActor } from '@/lib/auth/dal'
import { listCompanies } from '@/modules/crm/service'
import { CompanyListQuery, queryObject } from '@/modules/crm/repository'
import { CompanyTable } from '@/components/crm/CompanyTable'
import { Pagination } from '@/components/ui/Pagination'
import { LinkButton } from '@/components/ui/LinkButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'

export const metadata: Metadata = { title: 'รายชื่อบริษัท' }

export default async function CompaniesPage(props: PageProps<'/companies'>) {
  await getActor()
  const sp = await props.searchParams
  const values = queryObject(sp)
  const parsed = CompanyListQuery.safeParse(values)
  const q = parsed.success ? parsed.data : CompanyListQuery.parse({})

  const page = await listCompanies(q)

  const paginationParams: Record<string, string> = { ...values }
  delete paginationParams.page

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        group="CRM"
        module="Companies"
        title="รายชื่อบริษัท"
        actions={<LinkButton href="/companies/new">New company</LinkButton>}
      />
      <form
        method="get"
        action="/companies"
        className="grid grid-cols-1 gap-3 rounded-card border border-line bg-white p-4 min-[400px]:grid-cols-2 sm:grid-cols-4"
      >
        <Field label="ค้นหา" htmlFor="q">
          <Input id="q" name="q" defaultValue={values.q ?? ''} placeholder="ชื่อบริษัท, domain" />
        </Field>
        <div className="col-span-full">
          <Button type="submit">กรอง</Button>
        </div>
      </form>
      {page.items.length === 0 ? (
        <EmptyState title="ไม่พบบริษัท" />
      ) : (
        <>
          <CompanyTable items={page.items} />
          <Pagination
            page={page.page}
            pageSize={page.pageSize}
            total={page.total}
            basePath="/companies"
            params={paginationParams}
          />
        </>
      )}
    </div>
  )
}
