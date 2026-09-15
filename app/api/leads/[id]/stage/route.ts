import { NextResponse } from 'next/server'
import { withRoute, readJson } from '@/lib/http'
import { requireUser } from '@/lib/auth/dal'
import { DomainError } from '@/lib/errors'
import { StageChange } from '@/lib/contracts/crm'
import { changeStage, getLeadDetail, parseIdOrNotFound } from '@/modules/crm/service'

// [A] app/api/leads/[id]/stage/route.ts: see docs/design.md section 3's API
// table. `StageChange` already rejects LOST without a reason (400 via the
// zod refine); `changeStage` re-validates the same rule for direct callers.

export const POST = withRoute<RouteContext<'/api/leads/[id]/stage'>>(
  'POST /api/leads/[id]/stage',
  async (req, ctx) => {
    const actor = await requireUser(req)
    const id = parseIdOrNotFound((await ctx.params).id, 'lead')
    const input = await readJson(req, StageChange)
    const { changed } = await changeStage({ leadId: id, to: input.to, reason: input.reason, actor })
    const lead = await getLeadDetail(id)
    if (!lead) throw new DomainError('NOT_FOUND', 'lead not found')
    return NextResponse.json({ lead, changed })
  },
)
