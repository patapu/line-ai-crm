// OWNER: lane A — Server Component
import { getActor } from '@/lib/auth/dal'
import { listCompanyOptions, listUsers } from '@/modules/crm/service'
import { ContactForm } from '@/components/crm/ContactForm'

export default async function NewContactPage() {
  await getActor()
  const [companies, users] = await Promise.all([listCompanyOptions(), listUsers()])

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-900">สร้าง Contact ใหม่</h1>
      <ContactForm mode="create" companies={companies} users={users} />
    </div>
  )
}
