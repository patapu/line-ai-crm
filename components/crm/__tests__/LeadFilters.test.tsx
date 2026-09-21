import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { LeadFilters, countActiveLeadFilters, isLeadSortCustom } from '@/components/crm/LeadFilters'

// [tester] components/crm/__tests__/LeadFilters.test.tsx
// Covers the pure helpers backing the "ตัวกรอง" disclosure (S1 spec section 3):
// countActiveLeadFilters counts only LEAD_FILTER_KEYS (never sort/dir), and
// isLeadSortCustom flags a non-default sort or dir. Also covers the <details>
// markup: open only when active or sort is custom, and the "ใช้อยู่ n" badge
// only appears when n > 0.

const BASE_PROPS = { users: [], companies: [] }

/**
 * React SSR splits `ใช้อยู่ {count}` into a text node plus an expression
 * container, which renders as `ใช้อยู่ <!-- -->1` (a comment marker for
 * hydration). Match tolerating that optional comment node.
 */
function hasActiveBadge(html: string, count: number): boolean {
  return new RegExp(`ใช้อยู่\\s*(?:<!--\\s*-->\\s*)?${count}\\b`).test(html)
}

describe('countActiveLeadFilters', () => {
  it('returns 0 for an empty values object', () => {
    expect(countActiveLeadFilters({})).toBe(0)
  })

  it('returns 0 when every relevant key is whitespace-only', () => {
    expect(countActiveLeadFilters({ q: '   ', stage: '', ownerId: '\t', source: '', companyId: '', open: '' })).toBe(0)
  })

  it('counts several non-empty keys', () => {
    expect(countActiveLeadFilters({ q: 'acme', stage: 'NEW', ownerId: '', source: '', companyId: '', open: '' })).toBe(2)
  })

  it('counts all six keys when all are set', () => {
    expect(
      countActiveLeadFilters({
        q: 'acme',
        stage: 'NEW',
        ownerId: 'u1',
        source: 'WEBSITE',
        companyId: 'c1',
        open: 'true',
      }),
    ).toBe(6)
  })

  it('ignores sort and dir even when set', () => {
    expect(countActiveLeadFilters({ sort: 'value', dir: 'asc' })).toBe(0)
  })

  it('ignores unrelated/unknown keys', () => {
    expect(countActiveLeadFilters({ page: '2', foo: 'bar' })).toBe(0)
  })
})

describe('isLeadSortCustom', () => {
  it('is false for the default sort and dir', () => {
    expect(isLeadSortCustom({ sort: 'updatedAt', dir: 'desc' })).toBe(false)
  })

  it('is false when sort/dir are absent', () => {
    expect(isLeadSortCustom({})).toBe(false)
  })

  it('is false when sort/dir are whitespace-only', () => {
    expect(isLeadSortCustom({ sort: '  ', dir: '  ' })).toBe(false)
  })

  it('is true when sort is set to a non-default value', () => {
    expect(isLeadSortCustom({ sort: 'value', dir: 'desc' })).toBe(true)
  })

  it('is true when dir is set to a non-default value', () => {
    expect(isLeadSortCustom({ sort: 'updatedAt', dir: 'asc' })).toBe(true)
  })

  it('is true when only dir is set (sort absent)', () => {
    expect(isLeadSortCustom({ dir: 'asc' })).toBe(true)
  })
})

describe('LeadFilters disclosure markup', () => {
  it('renders <details> closed (no open attr) with no badge when no filters are active', () => {
    const html = renderToString(<LeadFilters values={{}} {...BASE_PROPS} />)

    expect(html).not.toMatch(/<details[^>]*\bopen\b/)
    expect(html).not.toContain('ใช้อยู่')
  })

  it('renders <details> open with "ใช้อยู่ 1" when one filter is active', () => {
    const html = renderToString(<LeadFilters values={{ q: 'acme' }} {...BASE_PROPS} />)

    expect(html).toMatch(/<details[^>]*\bopen\b/)
    expect(hasActiveBadge(html, 1)).toBe(true)
  })

  it('renders <details> open with "ใช้อยู่ 2" when two filters are active', () => {
    const html = renderToString(<LeadFilters values={{ q: 'acme', stage: 'NEW' }} {...BASE_PROPS} />)

    expect(html).toMatch(/<details[^>]*\bopen\b/)
    expect(hasActiveBadge(html, 2)).toBe(true)
  })

  it('renders <details> open with no badge when only sort is custom', () => {
    const html = renderToString(<LeadFilters values={{ sort: 'value' }} {...BASE_PROPS} />)

    expect(html).toMatch(/<details[^>]*\bopen\b/)
    expect(html).not.toContain('ใช้อยู่')
  })

  it('renders <details> closed when sort/dir are set to their defaults', () => {
    const html = renderToString(<LeadFilters values={{ sort: 'updatedAt', dir: 'desc' }} {...BASE_PROPS} />)

    expect(html).not.toMatch(/<details[^>]*\bopen\b/)
  })
})
