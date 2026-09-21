import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NavLinks } from '@/components/crm/NavLinks'

// [tester] components/crm/__tests__/NavLinks.test.tsx
// Covers the active-route matching rule in NavLinks (S5 plan item 11):
// '/' only matches the exact root, other links match exact path or any
// nested sub-path, and aria-current="page" tracks the same rule.

let mockPathname = '/'
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

const LINKS = [
  { href: '/', label: 'Pipeline' },
  { href: '/leads', label: 'Leads' },
  { href: '/contacts', label: 'Contacts' },
] as const

function render(pathname: string) {
  mockPathname = pathname
  return renderToString(<NavLinks links={LINKS} />)
}

/** Extracts the single `<a ...href="X"...>` tag for href X, attribute order agnostic. */
function anchorFor(html: string, href: string): string {
  const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = html.match(new RegExp(`<a [^>]*href="${escaped}"[^>]*>`))
  if (!match) throw new Error(`no <a> tag found for href="${href}" in: ${html}`)
  return match[0]
}

describe('NavLinks active route matching', () => {
  it('marks only the root link active when pathname is exactly "/"', () => {
    const html = render('/')

    expect(anchorFor(html, '/')).toContain('aria-current="page"')
    expect(anchorFor(html, '/leads')).not.toContain('aria-current="page"')
    expect(anchorFor(html, '/contacts')).not.toContain('aria-current="page"')
  })

  it('does not mark the root link active for a non-root pathname', () => {
    const html = render('/leads')

    expect(anchorFor(html, '/')).not.toContain('aria-current="page"')
  })

  it('marks a link active on an exact non-root path match', () => {
    const html = render('/leads')

    expect(anchorFor(html, '/leads')).toContain('aria-current="page"')
  })

  it('marks a link active on a nested sub-path', () => {
    const html = render('/leads/abc-123')

    expect(anchorFor(html, '/leads')).toContain('aria-current="page"')
  })

  it('does not treat "/leadsx" as a sub-path of "/leads" (prefix boundary)', () => {
    const html = render('/leadsx')

    expect(anchorFor(html, '/leads')).not.toContain('aria-current="page"')
  })

  it('renders every link label exactly once', () => {
    const html = render('/contacts')

    for (const link of LINKS) {
      const escaped = link.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const matches = html.match(new RegExp(escaped, 'g')) ?? []
      expect(matches.length).toBe(1)
    }
  })
})
