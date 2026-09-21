// OWNER: lane A — Server Component
import type { Metadata } from 'next'
import { getActor } from '@/lib/auth/dal'
import { CompanyForm } from '@/components/crm/CompanyForm'

export const metadata: Metadata = { title: 'สร้างบริษัทใหม่' }

export default async function NewCompanyPage() {
  await getActor()

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="text-xl font-bold text-primary-2">สร้างบริษัทใหม่</h1>
      <CompanyForm mode="create" />
    </div>
  )
}
