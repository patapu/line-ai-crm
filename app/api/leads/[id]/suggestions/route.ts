import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { withRoute } from '@/lib/http'
import { requireUser } from '@/lib/auth/dal'
import { DomainError } from '@/lib/errors'
import { IdSchema } from '@/lib/contracts/common'
import { listSuggestions, toSuggestionView } from '@/modules/copilot/service'

// [D] app/api/leads/[id]/suggestions/route.ts: lane owned. GET only, history
// for the InsightPanel (design.md section 3's API table). Not cached: it
// reads the DB on every call and the panel wants a fresh PENDING/APPROVED
// status right after an approve/reject.

export const runtime = 'nodejs'

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

function parseId(raw: string): string {
  const parsed = IdSchema.safeParse(raw)
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'invalid id', { id: ['must be a cuid'] })
  }
  return parsed.data
}

export const GET = withRoute(
  'GET /api/leads/[id]/suggestions',
  async (req: NextRequest, ctx: RouteContext<'/api/leads/[id]/suggestions'>) => {
    await requireUser(req)

    const { id: rawId } = await ctx.params
    const leadId = parseId(rawId)
    const { limit } = QuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams))

    const { items, hasLine } = await listSuggestions(leadId, { limit })

    return Response.json({ items: items.map(toSuggestionView), hasLine })
  },
)
