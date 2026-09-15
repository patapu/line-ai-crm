// OWNER: lane A — server component
import Link from 'next/link'
import { Table } from '@/components/ui/Table'
import { formatDateTime } from '@/components/ui/format'
import type { CompanyListItem } from '@/modules/crm/repository'

export interface CompanyTableProps {
  items: CompanyListItem[]
}

export function CompanyTable({ items }: CompanyTableProps) {
  return (
    <Table>
      <thead>
        <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
          <th className="px-3 py-2">Name</th>
          <th className="px-3 py-2">Domain</th>
          <th className="px-3 py-2">Industry</th>
          <th className="px-3 py-2">Size</th>
          <th className="px-3 py-2">Contacts</th>
          <th className="px-3 py-2">Leads</th>
          <th className="px-3 py-2">Updated</th>
        </tr>
      </thead>
      <tbody>
        {items.map((company) => (
          <tr key={company.id} className="border-b border-slate-100 last:border-0">
            <td className="px-3 py-2">
              <Link href={`/companies/${company.id}`} className="font-medium text-slate-900 hover:underline">
                {company.name}
              </Link>
            </td>
            <td className="px-3 py-2 text-slate-600">{company.domain ?? '-'}</td>
            <td className="px-3 py-2 text-slate-600">{company.industry ?? '-'}</td>
            <td className="px-3 py-2 text-slate-600">{company.sizeBand ?? '-'}</td>
            <td className="px-3 py-2 text-slate-600">{company.contactCount}</td>
            <td className="px-3 py-2 text-slate-600">{company.leadCount}</td>
            <td className="px-3 py-2 text-slate-500">{formatDateTime(company.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
