// OWNER: lane A — Server Component
import { getActor } from '@/lib/auth/dal'
import { CompanyForm } from '@/components/crm/CompanyForm'

export default async function NewCompanyPage() {
  await getActor()

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-900">สร้างบริษัทใหม่</h1>
      <CompanyForm mode="create" />
    </div>
  )
}
