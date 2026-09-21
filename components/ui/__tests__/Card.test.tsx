import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { Card } from '@/components/ui/Card'

// [tester] components/ui/__tests__/Card.test.tsx
// Covers the new `padding` prop added in S9 (used by PipelineBoard to
// shrink card padding): defaults to 'md', 'sm' swaps the class, and other
// HTML div attributes (className, data-*) still pass through unchanged.

describe('Card padding prop', () => {
  it('defaults to md padding (p-4) when no padding prop is given', () => {
    const html = renderToString(<Card>content</Card>)

    expect(html).toContain('p-4')
    expect(html).not.toContain('p-3')
  })

  it('applies sm padding (p-3) when padding="sm"', () => {
    const html = renderToString(<Card padding="sm">content</Card>)

    expect(html).toContain('p-3')
    expect(html).not.toMatch(/\bp-4\b/)
  })

  it('applies md padding (p-4) explicitly when padding="md"', () => {
    const html = renderToString(<Card padding="md">content</Card>)

    expect(html).toContain('p-4')
  })

  it('merges a custom className alongside the padding class', () => {
    const html = renderToString(
      <Card padding="sm" className="custom-class">
        content
      </Card>,
    )

    expect(html).toContain('p-3')
    expect(html).toContain('custom-class')
  })

  it('passes through arbitrary div attributes such as data-testid', () => {
    const html = renderToString(<Card data-testid="my-card">content</Card>)

    expect(html).toContain('data-testid="my-card"')
  })

  it('renders children content', () => {
    const html = renderToString(<Card>hello world</Card>)

    expect(html).toContain('hello world')
  })
})
