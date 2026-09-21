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
    <Table label="ตารางบริษัท">
      <thead>
        <tr className="border-b border-line bg-surface text-xs font-semibold text-muted">
          <th scope="col" className="px-3 py-2">Name</th>
          <th scope="col" className="px-3 py-2">Domain</th>
          <th scope="col" className="px-3 py-2">Industry</th>
          <th scope="col" className="px-3 py-2">Size</th>
          <th scope="col" className="px-3 py-2">Contacts</th>
          <th scope="col" className="px-3 py-2">Leads</th>
          <th scope="col" className="px-3 py-2">Updated</th>
        </tr>
      </thead>
      <tbody>
        {items.map((company) => (
          <tr key={company.id} className="border-b border-neutral-soft last:border-0 hover:bg-surface">
            <td className="px-3 py-2">
              <Link href={`/companies/${company.id}`} className="font-semibold text-primary-2 hover:underline">
                {company.name}
              </Link>
            </td>
            <td className="px-3 py-2 text-muted">{company.domain ?? '-'}</td>
            <td className="px-3 py-2 text-muted">{company.industry ?? '-'}</td>
            <td className="px-3 py-2 text-muted">{company.sizeBand ?? '-'}</td>
            <td className="px-3 py-2 text-muted">{company.contactCount}</td>
            <td className="px-3 py-2 text-muted">{company.leadCount}</td>
            <td className="px-3 py-2 text-muted">{formatDateTime(company.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
