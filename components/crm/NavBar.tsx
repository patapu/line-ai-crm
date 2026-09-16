// OWNER: lane A — server component
import Link from 'next/link'
import { LogoutButton } from '@/components/crm/LogoutButton'

export interface NavBarProps {
  name: string
  role: 'ADMIN' | 'SALES'
}

const LINKS = [
  { href: '/', label: 'Pipeline' },
  { href: '/leads', label: 'Leads' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/companies', label: 'Companies' },
] as const

export function NavBar({ name, role }: NavBarProps) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 p-4">
        <nav className="flex flex-wrap items-center gap-4">
          <span className="text-sm font-semibold text-slate-900">LINE AI CRM</span>
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-sm text-slate-600 hover:text-slate-900">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">
            {name} ({role})
          </span>
          <LogoutButton />
        </div>
      </div>
    </header>
  )
}
