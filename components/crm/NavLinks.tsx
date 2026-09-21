'use client'

// OWNER: lane A
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/components/ui/cn'

export interface NavLinksProps {
  links: readonly { href: string; label: string }[]
}

export function NavLinks({ links }: NavLinksProps) {
  const pathname = usePathname()

  return (
    <>
      {links.map((link) => {
        const active = link.href === '/' ? pathname === '/' : pathname === link.href || pathname.startsWith(`${link.href}/`)
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-8 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1.5 text-sm font-semibold md:px-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
              active ? 'bg-white text-primary' : 'text-white underline-offset-4 hover:bg-primary-2 hover:underline',
            )}
          >
            {link.label}
          </Link>
        )
      })}
    </>
  )
}
