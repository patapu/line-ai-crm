// OWNER: lane A — server component
import Link from 'next/link'
import { Table } from '@/components/ui/Table'
import { StageBadge } from '@/components/crm/StageBadge'
import { formatDateTime, formatMoney, fullName } from '@/components/ui/format'
import type { LeadListItem } from '@/modules/crm/types'

export interface LeadTableProps {
  items: LeadListItem[]
}

export function LeadTable({ items }: LeadTableProps) {
  return (
    <Table label="ตาราง Lead" minWidth="md">
      <thead>
        <tr className="border-b border-line bg-surface text-xs font-semibold text-muted whitespace-nowrap">
          <th scope="col" className="px-3 py-2">Title</th>
          <th scope="col" className="px-3 py-2">Contact</th>
          <th scope="col" className="px-3 py-2">Company</th>
          <th scope="col" className="px-3 py-2">Owner</th>
          <th scope="col" className="px-3 py-2">Stage</th>
          <th scope="col" className="px-3 py-2">Value</th>
          <th scope="col" className="px-3 py-2">Updated</th>
        </tr>
      </thead>
      <tbody>
        {items.map((lead) => (
          <tr key={lead.id} className="border-b border-neutral-soft last:border-0 hover:bg-surface whitespace-nowrap">
            <td className="px-3 py-2 whitespace-normal">
              <Link href={`/leads/${lead.id}`} className="block min-w-40 max-w-64 break-words font-semibold text-primary-2 hover:underline">
                {lead.title}
              </Link>
            </td>
            <td className="px-3 py-2 text-muted">{fullName(lead.contact.firstName, lead.contact.lastName)}</td>
            <td className="px-3 py-2 text-muted">{lead.company?.name ?? '-'}</td>
            <td className="px-3 py-2 text-muted">{lead.owner.name}</td>
            <td className="px-3 py-2">
              <StageBadge stage={lead.stage} />
            </td>
            <td className="px-3 py-2 text-muted">
              {lead.value !== null ? formatMoney(lead.value, lead.currency) : '-'}
            </td>
            <td className="px-3 py-2 text-muted">{formatDateTime(lead.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
