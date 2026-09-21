// OWNER: lane A — Server Component
import type { Metadata } from 'next'
import { getActor } from '@/lib/auth/dal'
import { getContact, listCompanyOptions, listUsers } from '@/modules/crm/service'
import { IdSchema } from '@/lib/contracts/common'
import { LeadForm } from '@/components/crm/LeadForm'
import type { ContactPickerOption } from '@/components/crm/ContactPicker'

export const metadata: Metadata = { title: 'สร้าง Lead ใหม่' }

export default async function NewLeadPage(props: PageProps<'/leads/new'>) {
  const actor = await getActor()
  const sp = await props.searchParams
  const raw = sp.contactId
  const rawContactId = Array.isArray(raw) ? raw[0] : raw

  const [users, companies] = await Promise.all([listUsers(), listCompanyOptions()])

  let initialContact: ContactPickerOption | null = null
  if (rawContactId && IdSchema.safeParse(rawContactId).success) {
    const contact = await getContact(rawContactId)
    if (contact) {
      initialContact = {
        id: contact.id,
        label: contact.lastName ? `${contact.firstName} ${contact.lastName}` : contact.firstName,
      }
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="text-xl font-bold text-primary-2">สร้าง Lead ใหม่</h1>
      <LeadForm
        mode="create"
        users={users}
        companies={companies}
        canReassign={actor.role === 'ADMIN'}
        initialContact={initialContact}
      />
    </div>
  )
}
