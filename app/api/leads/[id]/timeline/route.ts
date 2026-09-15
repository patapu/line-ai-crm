import { NextResponse } from 'next/server'
import { withRoute } from '@/lib/http'
import { requireUser } from '@/lib/auth/dal'
import { TimelineQuery } from '@/lib/contracts/timeline'
import { queryObject } from '@/modules/crm/repository'
import { getLeadTimeline, parseIdOrNotFound } from '@/modules/crm/service'

// [A] app/api/leads/[id]/timeline/route.ts: see docs/design.md section 3's
// API table. `before` is a cursor (ISO datetime of the last item), `limit`
// caps the page size.

export const GET = withRoute<RouteContext<'/api/leads/[id]/timeline'>>(
  'GET /api/leads/[id]/timeline',
  async (req, ctx) => {
    await requireUser(req)
    const id = parseIdOrNotFound((await ctx.params).id, 'lead')
    const q = TimelineQuery.parse(queryObject(req.nextUrl.searchParams))
    return NextResponse.json(await getLeadTimeline(id, q))
  },
)
