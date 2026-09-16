import { NextResponse } from 'next/server'
import { withRoute, readJson } from '@/lib/http'
import { requireUser } from '@/lib/auth/dal'
import { DomainError } from '@/lib/errors'
import { CompanyUpdate } from '@/lib/contracts/crm'
import { deleteCompany, getCompany, parseIdOrNotFound, updateCompany } from '@/modules/crm/service'

// [A] app/api/companies/[id]/route.ts: see docs/design.md section 3's API
// table. DELETE is a hard delete; deleteCompany throws CONFLICT (409) when
// the company still has linked contacts or leads.

export const GET = withRoute<RouteContext<'/api/companies/[id]'>>('GET /api/companies/[id]', async (req, ctx) => {
  await requireUser(req)
  const id = parseIdOrNotFound((await ctx.params).id, 'company')
  const company = await getCompany(id)
  if (!company) throw new DomainError('NOT_FOUND', 'company not found')
  return NextResponse.json(company)
})

export const PATCH = withRoute<RouteContext<'/api/companies/[id]'>>('PATCH /api/companies/[id]', async (req, ctx) => {
  const actor = await requireUser(req)
  const id = parseIdOrNotFound((await ctx.params).id, 'company')
  const input = await readJson(req, CompanyUpdate)
  const company = await updateCompany(id, input, actor)
  return NextResponse.json(company)
})

export const DELETE = withRoute<RouteContext<'/api/companies/[id]'>>(
  'DELETE /api/companies/[id]',
  async (req, ctx) => {
    const actor = await requireUser(req)
    const id = parseIdOrNotFound((await ctx.params).id, 'company')
    await deleteCompany(id, actor)
    return new NextResponse(null, { status: 204 })
  },
)
