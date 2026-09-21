import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { ContactPicker } from '@/components/crm/ContactPicker'

// [tester] components/crm/__tests__/ContactPicker.test.tsx
// Covers S20's ContactPicker fix: aria-invalid and aria-describedby passed
// into ContactPicker must be forwarded onto the underlying <Input>, so
// Field's cloneElement-based error wiring (see Field.test.tsx) actually
// reaches the rendered control instead of being silently dropped.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

describe('ContactPicker aria forwarding', () => {
  it('forwards aria-invalid and aria-describedby onto the input', () => {
    const html = renderToString(
      <ContactPicker
        id="contact"
        name="contactId"
        initial={null}
        aria-invalid
        aria-describedby="contact-error"
      />,
    )

    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('aria-describedby="contact-error"')
  })

  it('omits aria-invalid and aria-describedby when they are not provided', () => {
    const html = renderToString(<ContactPicker id="contact" name="contactId" initial={null} />)

    expect(html).not.toContain('aria-invalid')
    expect(html).not.toContain('aria-describedby')
  })

  it('still renders the initial selected label and hidden id input', () => {
    const html = renderToString(
      <ContactPicker id="contact" name="contactId" initial={{ id: 'c1', label: 'Somchai' }} />,
    )

    expect(html).toContain('value="Somchai"')
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="contactId"[^>]*value="c1"/)
  })
})
