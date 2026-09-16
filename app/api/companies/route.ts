import { NextResponse } from 'next/server'
import { withRoute, readJson } from '@/lib/http'
import { requireUser } from '@/lib/auth/dal'
import { CompanyCreate } from '@/lib/contracts/crm'
import { CompanyListQuery, queryObject } from '@/modules/crm/repository'
import { createCompany, listCompanies } from '@/modules/crm/service'

// [A] app/api/companies/route.ts: see docs/design.md section 3's API table.
// `CompanyListQuery` is defined in modules/crm/repository.ts (lane A owned),
// not lib/contracts/crm.ts: it is not part of the frozen contract surface.

export const GET = withRoute('GET /api/companies', async (req) => {
  await requireUser(req)
  const q = CompanyListQuery.parse(queryObject(req.nextUrl.searchParams))
  return NextResponse.json(await listCompanies(q))
})

export const POST = withRoute('POST /api/companies', async (req) => {
  const actor = await requireUser(req)
  const input = await readJson(req, CompanyCreate)
  const company = await createCompany(input, actor)
  return NextResponse.json(company, { status: 201 })
})
