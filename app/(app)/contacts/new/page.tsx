// OWNER: lane A — Server Component
import type { Metadata } from 'next'
import { getActor } from '@/lib/auth/dal'
import { listCompanyOptions, listUsers } from '@/modules/crm/service'
import { ContactForm } from '@/components/crm/ContactForm'

export const metadata: Metadata = { title: 'สร้าง Contact ใหม่' }

export default async function NewContactPage() {
  await getActor()
  const [companies, users] = await Promise.all([listCompanyOptions(), listUsers()])

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="text-xl font-bold text-primary-2">สร้าง Contact ใหม่</h1>
      <ContactForm mode="create" companies={companies} users={users} />
    </div>
  )
}
