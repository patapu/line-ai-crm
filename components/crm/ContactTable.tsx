// OWNER: lane A — server component
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Table } from '@/components/ui/Table'
import { formatDateTime, fullName } from '@/components/ui/format'
import type { ContactListItem } from '@/modules/crm/repository'

export interface ContactTableProps {
  items: ContactListItem[]
}

export function ContactTable({ items }: ContactTableProps) {
  return (
    <Table label="ตาราง Contact">
      <thead>
        <tr className="border-b border-line bg-surface text-xs font-semibold text-muted">
          <th scope="col" className="px-3 py-2">Name</th>
          <th scope="col" className="px-3 py-2">Email</th>
          <th scope="col" className="px-3 py-2">Phone</th>
          <th scope="col" className="px-3 py-2">Company</th>
          <th scope="col" className="px-3 py-2">Owner</th>
          <th scope="col" className="px-3 py-2">LINE</th>
          <th scope="col" className="px-3 py-2">Leads</th>
          <th scope="col" className="px-3 py-2">Updated</th>
        </tr>
      </thead>
      <tbody>
        {items.map((contact) => (
          <tr key={contact.id} className="border-b border-neutral-soft last:border-0 hover:bg-surface">
            <td className="px-3 py-2">
              <Link href={`/contacts/${contact.id}`} className="font-semibold text-primary-2 hover:underline">
                {fullName(contact.firstName, contact.lastName)}
              </Link>
            </td>
            <td className="px-3 py-2 text-muted">{contact.email ?? '-'}</td>
            <td className="px-3 py-2 text-muted">{contact.phone ?? '-'}</td>
            <td className="px-3 py-2 text-muted">{contact.company?.name ?? '-'}</td>
            <td className="px-3 py-2 text-muted">{contact.owner?.name ?? '-'}</td>
            <td className="px-3 py-2">
              {contact.hasLine ? <Badge tone="green">LINE</Badge> : <span className="text-muted">-</span>}
            </td>
            <td className="px-3 py-2 text-muted">{contact.leadCount}</td>
            <td className="px-3 py-2 text-muted">{formatDateTime(contact.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
