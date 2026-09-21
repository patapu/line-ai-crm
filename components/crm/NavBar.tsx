// OWNER: lane A — server component
import { NavLinks } from '@/components/crm/NavLinks'
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
    <header className="bg-primary text-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-bold text-white">LINE AI CRM</span>
          <nav aria-label="เมนูหลัก" className="flex flex-wrap items-center gap-2">
            <NavLinks links={LINKS} />
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-white">
            {name} ({role})
          </span>
          <LogoutButton />
        </div>
      </div>
    </header>
  )
}
