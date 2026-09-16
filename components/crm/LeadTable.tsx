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
    <Table>
      <thead>
        <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
          <th className="px-3 py-2">Title</th>
          <th className="px-3 py-2">Contact</th>
          <th className="px-3 py-2">Company</th>
          <th className="px-3 py-2">Owner</th>
          <th className="px-3 py-2">Stage</th>
          <th className="px-3 py-2">Value</th>
          <th className="px-3 py-2">Updated</th>
        </tr>
      </thead>
      <tbody>
        {items.map((lead) => (
          <tr key={lead.id} className="border-b border-slate-100 last:border-0">
            <td className="px-3 py-2">
              <Link href={`/leads/${lead.id}`} className="font-medium text-slate-900 hover:underline">
                {lead.title}
              </Link>
            </td>
            <td className="px-3 py-2 text-slate-600">{fullName(lead.contact.firstName, lead.contact.lastName)}</td>
            <td className="px-3 py-2 text-slate-600">{lead.company?.name ?? '-'}</td>
            <td className="px-3 py-2 text-slate-600">{lead.owner.name}</td>
            <td className="px-3 py-2">
              <StageBadge stage={lead.stage} />
            </td>
            <td className="px-3 py-2 text-slate-600">
              {lead.value !== null ? formatMoney(lead.value, lead.currency) : '-'}
            </td>
            <td className="px-3 py-2 text-slate-500">{formatDateTime(lead.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
