// OWNER: lane A — Server Component
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
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Companies</h1>
        <LinkButton href="/companies/new">New company</LinkButton>
      </div>
      <form
        method="get"
        action="/companies"
        className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4"
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
