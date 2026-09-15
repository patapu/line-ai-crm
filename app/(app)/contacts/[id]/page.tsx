// OWNER: lane A — Server Component
import { notFound } from 'next/navigation'
import { getActor } from '@/lib/auth/dal'
import { getContact, listCompanyOptions, listUsers } from '@/modules/crm/service'
import { IdSchema } from '@/lib/contracts/common'
import { Card } from '@/components/ui/Card'
import { ContactForm } from '@/components/crm/ContactForm'
import { DeleteButton } from '@/components/crm/DeleteButton'
import { LinkButton } from '@/components/ui/LinkButton'

export default async function ContactDetailPage(props: PageProps<'/contacts/[id]'>) {
  await getActor()
  const { id } = await props.params
  if (!IdSchema.safeParse(id).success) notFound()

  const contact = await getContact(id)
  if (!contact) notFound()

  const [companies, users] = await Promise.all([listCompanyOptions(), listUsers()])
  const name = contact.lastName ? `${contact.firstName} ${contact.lastName}` : contact.firstName

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">{name}</h1>
        <LinkButton href={`/leads/new?contactId=${contact.id}`} size="sm">
          สร้าง Lead
        </LinkButton>
      </div>
      <Card>
        <p className="text-sm text-slate-600">จำนวน Lead: {contact.leadCount}</p>
      </Card>
      <ContactForm mode="edit" contact={contact} companies={companies} users={users} />
      <DeleteButton
        url={`/api/contacts/${contact.id}`}
        redirectTo="/contacts"
        confirmText="ยืนยันการลบ Contact นี้?"
      />
    </div>
  )
}
