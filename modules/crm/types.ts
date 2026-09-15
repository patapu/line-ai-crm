import type { LeadSource, LeadStage } from '@/lib/generated/prisma/client'

// [F] modules/crm/types.ts: see docs/design.md section 4.
//
// `LeadListItem` and `LeadDetail` are referenced by name in
// modules/crm/service.ts's signatures (`listLeads(...): Promise<Paged<LeadListItem>>`,
// `getLeadDetail(id): Promise<LeadDetail | null>`); their fields are not
// spelled out in the design doc, so the shapes below are inferred from the
// Lead model (schema.prisma) and the API table in section 3. These types are
// frozen: Lane A's service body must match them, not the other way round.

export interface LeadListItem {
  id: string
  title: string
  stage: LeadStage
  source: LeadSource
  value: number | null
  currency: string
  score: number | null
  stageChangedAt: string
  updatedAt: string
  contact: { id: string; firstName: string; lastName: string | null }
  company: { id: string; name: string } | null
  owner: { id: string; name: string }
}

export interface LeadDetail extends LeadListItem {
  createdAt: string
  closedAt: string | null
  lostReason: string | null
  scoreUpdatedAt: string | null
  createdBy: { id: string; name: string } | null
  ownerId: string
  contact: { id: string; firstName: string; lastName: string | null; hasLine: boolean; lineDisplayName: string | null }
}
