import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { Table, TABLE_MIN_WIDTH_CLASS } from '@/components/ui/Table'

// [tester] components/ui/__tests__/Table.test.tsx
// Covers the new minWidth prop (S1 spec section 1): the min-w-[...] class is
// applied only when minWidth is given (backward compatible default), the
// right class is picked per size, and the scroll-hint paragraph switches
// from md:hidden to lg:hidden and only renders when label is set.

describe('Table minWidth prop', () => {
  it('applies no min-w class when minWidth is not given', () => {
    const html = renderToString(
      <Table>
        <tbody>
          <tr>
            <td>x</td>
          </tr>
        </tbody>
      </Table>,
    )

    expect(html).not.toMatch(/min-w-\[/)
  })

  it('applies min-w-[720px] when minWidth="md"', () => {
    const html = renderToString(
      <Table minWidth="md">
        <tbody>
          <tr>
            <td>x</td>
          </tr>
        </tbody>
      </Table>,
    )

    expect(html).toContain(TABLE_MIN_WIDTH_CLASS.md)
    expect(html).toContain('min-w-[720px]')
  })

  it('applies min-w-[640px] when minWidth="sm"', () => {
    const html = renderToString(
      <Table minWidth="sm">
        <tbody>
          <tr>
            <td>x</td>
          </tr>
        </tbody>
      </Table>,
    )

    expect(html).toContain(TABLE_MIN_WIDTH_CLASS.sm)
    expect(html).toContain('min-w-[640px]')
  })

  it('merges a custom className alongside the minWidth class', () => {
    const html = renderToString(
      <Table minWidth="md" className="custom-class">
        <tbody>
          <tr>
            <td>x</td>
          </tr>
        </tbody>
      </Table>,
    )

    expect(html).toContain('min-w-[720px]')
    expect(html).toContain('custom-class')
  })

  it('does not render the scroll hint when label is not given', () => {
    const html = renderToString(
      <Table minWidth="md">
        <tbody>
          <tr>
            <td>x</td>
          </tr>
        </tbody>
      </Table>,
    )

    expect(html).not.toContain('เลื่อนตารางไปทางขวา')
  })

  it('renders the scroll hint with lg:hidden (not md:hidden) when label is given', () => {
    const html = renderToString(
      <Table label="ตารางลีด" minWidth="md">
        <tbody>
          <tr>
            <td>x</td>
          </tr>
        </tbody>
      </Table>,
    )

    const hintMatch = html.match(/<p[^>]*>เลื่อนตารางไปทางขวา[^<]*<\/p>/)
    expect(hintMatch).not.toBeNull()
    expect(hintMatch![0]).toContain('lg:hidden')
    expect(hintMatch![0]).not.toContain('md:hidden')
  })

  it('wraps in a labelled, focusable scroll region when label is given', () => {
    const html = renderToString(
      <Table label="ตารางลีด" minWidth="md">
        <tbody>
          <tr>
            <td>x</td>
          </tr>
        </tbody>
      </Table>,
    )

    expect(html).toContain('role="region"')
    expect(html).toContain('aria-label="ตารางลีด"')
    expect(html).toContain('tabindex="0"')
  })
})
