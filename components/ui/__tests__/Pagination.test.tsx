import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { Pagination } from '@/components/ui/Pagination'

// [tester] components/ui/__tests__/Pagination.test.tsx
// Covers the disabled prev/next state: it must render as a plain,
// non-focusable <span> (not a <Link>/<a>, and without aria-disabled or
// pointer-events-none), while the enabled state still renders a real
// <a href> so keyboard/tab order skips disabled pager controls.

const BASE_PROPS = {
  pageSize: 10,
  basePath: '/leads',
  params: {} as Record<string, string>,
}

describe('Pagination disabled state', () => {
  it('renders prev as a plain non-focusable span when on page 1', () => {
    const html = renderToString(<Pagination {...BASE_PROPS} page={1} total={30} />)

    expect(html).toMatch(/<span[^>]*>\s*ก่อนหน้า/)
    expect(html).not.toMatch(/<a[^>]*>\s*ก่อนหน้า/)
  })

  it('renders next as a real link when more pages remain', () => {
    const html = renderToString(<Pagination {...BASE_PROPS} page={1} total={30} />)

    expect(html).toMatch(/<a[^>]*href="[^"]*page=2[^"]*"[^>]*>\s*ถัดไป/)
  })

  it('renders next as a plain non-focusable span on the last page', () => {
    const html = renderToString(<Pagination {...BASE_PROPS} page={3} total={30} />)

    expect(html).toMatch(/<span[^>]*>\s*ถัดไป/)
    expect(html).not.toMatch(/<a[^>]*>\s*ถัดไป/)
  })

  it('renders prev as a real link when a previous page exists', () => {
    const html = renderToString(<Pagination {...BASE_PROPS} page={3} total={30} />)

    expect(html).toMatch(/<a[^>]*href="[^"]*page=2[^"]*"[^>]*>\s*ก่อนหน้า/)
  })

  it('disabled spans never carry aria-disabled, pointer-events-none, or href', () => {
    const html = renderToString(<Pagination {...BASE_PROPS} page={1} total={5} />)
    const spanMatch = html.match(/<span[^>]*>\s*ก่อนหน้า/)

    expect(spanMatch).not.toBeNull()
    expect(spanMatch![0]).not.toContain('aria-disabled')
    expect(spanMatch![0]).not.toContain('pointer-events-none')
    expect(spanMatch![0]).not.toContain('href')
  })

  it('keeps both prev and next disabled (as spans, not links) when there is only one page total', () => {
    const html = renderToString(<Pagination {...BASE_PROPS} page={1} total={1} />)

    const disabledSpans = html.match(/<span[^>]*>\s*(ก่อนหน้า|ถัดไป)/g) ?? []
    expect(disabledSpans.length).toBe(2)
    expect(html).not.toMatch(/<a[^>]*>\s*(ก่อนหน้า|ถัดไป)/)
  })
})
