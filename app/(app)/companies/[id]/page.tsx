// OWNER: lane A — Server Component
import { notFound } from 'next/navigation'
import { getActor } from '@/lib/auth/dal'
import { getCompany } from '@/modules/crm/service'
import { IdSchema } from '@/lib/contracts/common'
import { Card } from '@/components/ui/Card'
import { CompanyForm } from '@/components/crm/CompanyForm'
import { DeleteButton } from '@/components/crm/DeleteButton'

export default async function CompanyDetailPage(props: PageProps<'/companies/[id]'>) {
  await getActor()
  const { id } = await props.params
  if (!IdSchema.safeParse(id).success) notFound()

  const company = await getCompany(id)
  if (!company) notFound()

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-900">{company.name}</h1>
      <Card>
        <p className="text-sm text-slate-600">Contacts: {company.contactCount}</p>
        <p className="text-sm text-slate-600">Leads: {company.leadCount}</p>
      </Card>
      <CompanyForm mode="edit" company={company} />
      <DeleteButton
        url={`/api/companies/${company.id}`}
        redirectTo="/companies"
        confirmText="ยืนยันการลบบริษัทนี้?"
      />
    </div>
  )
}
