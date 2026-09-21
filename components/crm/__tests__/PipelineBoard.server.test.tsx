import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { PipelineBoard, type PipelineColumn } from '@/components/crm/PipelineBoard'
import type { LeadListItem } from '@/modules/crm/types'
import { STAGES } from '@/components/crm/constants'

// [D-tester] components/crm/__tests__/PipelineBoard.server.test.tsx
// Server-render check for lane A's mobile pipeline board (S1 change to
// PipelineBoard.tsx): asserts the mobile chip nav links to every stage
// section by id, the section ids/aria-labels/region role are present, and
// the empty-column copy shows for stages with no leads.

function makeLead(overrides: Partial<LeadListItem> = {}): LeadListItem {
  return {
    id: 'lead-1',
    title: 'ทดสอบ lead',
    stage: 'NEW',
    source: 'MANUAL',
    value: 1000,
    currency: 'THB',
    score: null,
    stageChangedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    contact: { id: 'contact-1', firstName: 'สมชาย', lastName: 'ใจดี' },
    company: null,
    owner: { id: 'owner-1', name: 'เจ้าของ' },
    ...overrides,
  }
}

function makeColumns(withLeads: boolean): PipelineColumn[] {
  return STAGES.map((stage, index) => ({
    stage,
    total: withLeads && stage === 'NEW' ? 1 : 0,
    items: withLeads && stage === 'NEW' ? [makeLead({ id: `lead-${index}`, stage })] : [],
  }))
}

describe('PipelineBoard server render', () => {
  it('renders 5 mobile chips linking to each stage section with counts', () => {
    const html = renderToString(<PipelineBoard columns={makeColumns(true)} />)

    for (const stage of STAGES) {
      expect(html).toContain(`href="#stage-${stage}"`)
    }
  })

  it('renders a section with matching id for every stage', () => {
    const html = renderToString(<PipelineBoard columns={makeColumns(true)} />)

    for (const stage of STAGES) {
      expect(html).toContain(`id="stage-${stage}"`)
    }
  })

  it('renders the columns region with role and aria-label', () => {
    const html = renderToString(<PipelineBoard columns={makeColumns(true)} />)

    expect(html).toContain('role="region"')
    expect(html).toContain('aria-label="คอลัมน์สถานะ lead"')
  })

  it('shows the count on the NEW stage chip and section when it has one lead', () => {
    const html = renderToString(<PipelineBoard columns={makeColumns(true)} />)

    expect(html).toContain('href="#stage-NEW"')
    // The NEW section aria-label embeds the Thai stage label and count.
    expect(html).toMatch(/aria-label="[^"]*1 รายการ"/)
  })

  it('shows the empty-column copy for stages with no leads', () => {
    const html = renderToString(<PipelineBoard columns={makeColumns(false)} />)

    expect(html).toContain('ยังไม่มี lead ในสถานะนี้')
  })

  it('shows the empty-column copy for every stage when no leads exist at all', () => {
    const html = renderToString(<PipelineBoard columns={makeColumns(false)} />)
    const matches = html.match(/ยังไม่มี lead ในสถานะนี้/g) ?? []

    expect(matches.length).toBe(STAGES.length)
  })
})
