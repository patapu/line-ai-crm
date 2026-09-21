import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NavBar } from '@/components/crm/NavBar'

// [tester] components/crm/__tests__/NavBar.test.tsx
// NavBar is a server component that renders the client NavLinks (which calls
// usePathname) and LogoutButton (which calls useRouter), so both hooks from
// next/navigation must be mocked, following NavLinks.test.tsx's style.

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}))

/** Returns the opening `<span ...>` tag of the nearest span wrapping `text`. */
function spanOpenTagFor(html: string, text: string): string {
  const textIndex = html.indexOf(text)
  if (textIndex === -1) throw new Error(`text "${text}" not found in: ${html}`)
  const openIndex = html.lastIndexOf('<span ', textIndex)
  if (openIndex === -1) throw new Error(`no enclosing <span> found for "${text}" in: ${html}`)
  const closeIndex = html.indexOf('>', openIndex)
  return html.slice(openIndex, closeIndex + 1)
}

describe('NavBar user label', () => {
  it('renders the user name inside the label element', () => {
    const html = renderToString(<NavBar name="สมชาย ใจดี" role="ADMIN" />)

    expect(html).toContain('สมชาย ใจดี')
  })

  it('applies the min-w-0, max-w-full, and truncate classes to the user label span', () => {
    const html = renderToString(<NavBar name="สมชาย ใจดี" role="ADMIN" />)
    const span = spanOpenTagFor(html, 'สมชาย ใจดี')

    expect(span).toContain('min-w-0')
    expect(span).toContain('max-w-full')
    expect(span).toContain('truncate')
  })
})
