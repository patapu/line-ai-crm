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
      <div className="mx-auto grid max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-2 md:flex md:gap-4 md:py-3">
        <span className="col-start-1 row-start-1 whitespace-nowrap text-base font-bold text-white">LINE AI CRM</span>
        <nav
          aria-label="เมนูหลัก"
          className="col-span-3 col-start-1 row-start-2 -m-1 flex gap-1 overflow-x-auto p-1 md:m-0 md:flex-1 md:gap-2 md:overflow-visible md:p-0"
        >
          <NavLinks links={LINKS} />
        </nav>
        <span className="col-start-2 row-start-1 min-w-0 max-w-full justify-self-end truncate text-xs text-white md:max-w-60 md:text-sm">
          {name}
          <span className="max-sm:hidden"> ({role})</span>
        </span>
        <div className="col-start-3 row-start-1">
          <LogoutButton />
        </div>
      </div>
    </header>
  )
}
