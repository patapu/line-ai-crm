import type { NextRequest } from 'next/server'
import type { z } from 'zod'
import { withRoute, readJson } from '@/lib/http'
import { requireUser } from '@/lib/auth/dal'
import { DomainError } from '@/lib/errors'
import { IdSchema } from '@/lib/contracts/common'
import { InsightRequest } from '@/lib/contracts/copilot'
import { requestInsight, toSuggestionView } from '@/modules/copilot/service'

// [B] app/api/leads/[id]/insights/route.ts: lane owned. POST only, see
// docs/design.md section 3's API table. Never caches (POST never does under
// Next 16 anyway). maxDuration 30 gives the model call (SDK timeout up to
// COPILOT_TIMEOUT_MS) plus one DB transaction real headroom on Vercel.

export const runtime = 'nodejs'
export const maxDuration = 30

function parseId(raw: string): string {
  const parsed = IdSchema.safeParse(raw)
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'invalid id', { id: ['must be a cuid'] })
  }
  return parsed.data
}

export const POST = withRoute(
  'POST /api/leads/[id]/insights',
  async (req: NextRequest, ctx: RouteContext<'/api/leads/[id]/insights'>) => {
    // 401 before 400: an unauthenticated caller never even learns whether
    // the id in the URL looks like a valid cuid.
    const actor = await requireUser(req)

    const { id: rawId } = await ctx.params
    const leadId = parseId(rawId)

    // InsightRequest is all-optional, so an empty body (no replyLocale) is a
    // valid request: skip readJson's JSON.parse entirely rather than fail on
    // a body that is not actually required.
    const body: z.infer<typeof InsightRequest> =
      req.headers.get('content-length') === '0' ? {} : await readJson(req, InsightRequest)

    const suggestion = await requestInsight({ leadId, actor, replyLocale: body.replyLocale }, {})

    return Response.json({ suggestion: toSuggestionView(suggestion) }, { status: 201 })
  },
)
