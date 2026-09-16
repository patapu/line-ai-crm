import { NextResponse } from 'next/server'
import { withRoute, readJson } from '@/lib/http'
import { requireUser } from '@/lib/auth/dal'
import { ActivityCreate } from '@/lib/contracts/crm'
import { createActivity, parseIdOrNotFound } from '@/modules/crm/service'

// [A] app/api/leads/[id]/activities/route.ts: see docs/design.md section 3's
// API table. Any session user may log an activity (NOTE/CALL/MEETING/EMAIL);
// this is not restricted to the lead owner or an admin.

export const POST = withRoute<RouteContext<'/api/leads/[id]/activities'>>(
  'POST /api/leads/[id]/activities',
  async (req, ctx) => {
    const actor = await requireUser(req)
    const id = parseIdOrNotFound((await ctx.params).id, 'lead')
    const input = await readJson(req, ActivityCreate)
    const activity = await createActivity(id, input, actor)
    return NextResponse.json(activity, { status: 201 })
  },
)
