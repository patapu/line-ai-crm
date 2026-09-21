// OWNER: lane A — Server Component
import type { Metadata } from 'next'
import Link from 'next/link'
import { getActor } from '@/lib/auth/dal'
import { listCompanyOptions, listContacts } from '@/modules/crm/service'
import { queryObject } from '@/modules/crm/repository'
import { ContactListQuery } from '@/lib/contracts/crm'
import { ContactTable } from '@/components/crm/ContactTable'
import { Pagination } from '@/components/ui/Pagination'
import { LinkButton } from '@/components/ui/LinkButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'

export const metadata: Metadata = { title: 'รายชื่อ Contact' }

export default async function ContactsPage(props: PageProps<'/contacts'>) {
  await getActor()
  const sp = await props.searchParams
  const values = queryObject(sp)
  const parsed = ContactListQuery.safeParse(values)
  const q = parsed.success ? parsed.data : ContactListQuery.parse({})

  const [page, companies] = await Promise.all([listContacts(q), listCompanyOptions()])

  const paginationParams: Record<string, string> = { ...values }
  delete paginationParams.page

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        group="CRM"
        module="Contacts"
        title="รายชื่อ Contact"
        actions={<LinkButton href="/contacts/new">New contact</LinkButton>}
      />
      <form
        method="get"
        action="/contacts"
        className="grid grid-cols-1 gap-3 rounded-card border border-line bg-white p-4 min-[340px]:grid-cols-2 sm:grid-cols-4"
      >
        <div className="col-span-full sm:col-span-1">
          <Field label="ค้นหา" htmlFor="q">
            <Input id="q" name="q" defaultValue={values.q ?? ''} placeholder="ชื่อ, อีเมล, เบอร์โทร" />
          </Field>
        </div>
        <Field label="บริษัท" htmlFor="companyId">
          <Select id="companyId" name="companyId" defaultValue={values.companyId ?? ''}>
            <option value="">ทั้งหมด</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="LINE" htmlFor="hasLine">
          <Select id="hasLine" name="hasLine" defaultValue={values.hasLine ?? ''}>
            <option value="">ทั้งหมด</option>
            <option value="true">มี LINE</option>
            <option value="false">ไม่มี LINE</option>
          </Select>
        </Field>
        <div className="col-span-full flex flex-wrap items-center gap-3">
          <Button type="submit">กรอง</Button>
          <Link href="/contacts" className="text-sm font-semibold text-primary-2 hover:underline">
            ล้างตัวกรอง
          </Link>
        </div>
      </form>
      {page.items.length === 0 ? (
        <EmptyState title="ไม่พบ Contact" />
      ) : (
        <>
          <ContactTable items={page.items} />
          <Pagination
            page={page.page}
            pageSize={page.pageSize}
            total={page.total}
            basePath="/contacts"
            params={paginationParams}
          />
        </>
      )}
    </div>
  )
}
