import { NextResponse } from 'next/server'
import { withRoute, readJson } from '@/lib/http'
import { requireUser } from '@/lib/auth/dal'
import { DomainError } from '@/lib/errors'
import { LeadCreate, LeadListQuery } from '@/lib/contracts/crm'
import { queryObject } from '@/modules/crm/repository'
import { createLead, getLeadDetail, listLeads } from '@/modules/crm/service'

// [A] app/api/leads/route.ts: see docs/design.md section 3's API table.

export const GET = withRoute('GET /api/leads', async (req) => {
  await requireUser(req)
  const q = LeadListQuery.parse(queryObject(req.nextUrl.searchParams))
  return NextResponse.json(await listLeads(q))
})

export const POST = withRoute('POST /api/leads', async (req) => {
  const actor = await requireUser(req)
  const input = await readJson(req, LeadCreate)
  const lead = await createLead(input, actor)
  const detail = await getLeadDetail(lead.id)
  if (!detail) throw new DomainError('INTERNAL', 'lead not found after create')
  return NextResponse.json(detail, { status: 201 })
})
