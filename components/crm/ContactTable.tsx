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
    <Table>
      <thead>
        <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
          <th className="px-3 py-2">Name</th>
          <th className="px-3 py-2">Email</th>
          <th className="px-3 py-2">Phone</th>
          <th className="px-3 py-2">Company</th>
          <th className="px-3 py-2">Owner</th>
          <th className="px-3 py-2">LINE</th>
          <th className="px-3 py-2">Leads</th>
          <th className="px-3 py-2">Updated</th>
        </tr>
      </thead>
      <tbody>
        {items.map((contact) => (
          <tr key={contact.id} className="border-b border-slate-100 last:border-0">
            <td className="px-3 py-2">
              <Link href={`/contacts/${contact.id}`} className="font-medium text-slate-900 hover:underline">
                {fullName(contact.firstName, contact.lastName)}
              </Link>
            </td>
            <td className="px-3 py-2 text-slate-600">{contact.email ?? '-'}</td>
            <td className="px-3 py-2 text-slate-600">{contact.phone ?? '-'}</td>
            <td className="px-3 py-2 text-slate-600">{contact.company?.name ?? '-'}</td>
            <td className="px-3 py-2 text-slate-600">{contact.owner?.name ?? '-'}</td>
            <td className="px-3 py-2">
              {contact.hasLine ? <Badge tone="green">LINE</Badge> : <span className="text-slate-400">-</span>}
            </td>
            <td className="px-3 py-2 text-slate-600">{contact.leadCount}</td>
            <td className="px-3 py-2 text-slate-500">{formatDateTime(contact.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
