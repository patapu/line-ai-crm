import { NextResponse } from 'next/server'
import { withRoute, readJson } from '@/lib/http'
import { requireUser } from '@/lib/auth/dal'
import { DomainError } from '@/lib/errors'
import { LeadUpdate } from '@/lib/contracts/crm'
import { getLeadDetail, parseIdOrNotFound, updateLead } from '@/modules/crm/service'

// [A] app/api/leads/[id]/route.ts: see docs/design.md section 3's API table.
// Every route that returns a lead re-reads it via getLeadDetail: numbers
// instead of Decimal strings, and lineUserId is never exposed in a DTO.

export const GET = withRoute<RouteContext<'/api/leads/[id]'>>('GET /api/leads/[id]', async (req, ctx) => {
  await requireUser(req)
  const id = parseIdOrNotFound((await ctx.params).id, 'lead')
  const lead = await getLeadDetail(id)
  if (!lead) throw new DomainError('NOT_FOUND', 'lead not found')
  return NextResponse.json(lead)
})

export const PATCH = withRoute<RouteContext<'/api/leads/[id]'>>('PATCH /api/leads/[id]', async (req, ctx) => {
  const actor = await requireUser(req)
  const id = parseIdOrNotFound((await ctx.params).id, 'lead')
  const input = await readJson(req, LeadUpdate)
  await updateLead(id, input, actor)
  const detail = await getLeadDetail(id)
  if (!detail) throw new DomainError('NOT_FOUND', 'lead not found')
  return NextResponse.json(detail)
})
