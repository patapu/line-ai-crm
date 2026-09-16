import type { NextRequest } from 'next/server'
import type { z } from 'zod'
import { withRoute, readJson } from '@/lib/http'
import { requireUser } from '@/lib/auth/dal'
import { DomainError } from '@/lib/errors'
import { IdSchema } from '@/lib/contracts/common'
import { SuggestionReject } from '@/lib/contracts/copilot'
import { rejectSuggestion, toSuggestionView } from '@/modules/copilot/service'

// [D] app/api/suggestions/[id]/reject/route.ts: lane owned. POST only, see
// docs/design.md section 3's API table and section 5B's reject flow.

export const runtime = 'nodejs'

function parseId(raw: string): string {
  const parsed = IdSchema.safeParse(raw)
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'invalid id', { id: ['must be a cuid'] })
  }
  return parsed.data
}

export const POST = withRoute(
  'POST /api/suggestions/[id]/reject',
  async (req: NextRequest, ctx: RouteContext<'/api/suggestions/[id]/reject'>) => {
    const actor = await requireUser(req)

    const { id: rawId } = await ctx.params
    const suggestionId = parseId(rawId)

    // SuggestionReject's only field is optional, so an empty body (reject
    // with no reason) is valid: skip readJson's JSON.parse in that case.
    const body: z.infer<typeof SuggestionReject> =
      req.headers.get('content-length') === '0' ? {} : await readJson(req, SuggestionReject)

    const suggestion = await rejectSuggestion({ suggestionId, actor, reason: body.reason })

    return Response.json({ suggestion: toSuggestionView(suggestion) }, { status: 200 })
  },
)
