import { NextResponse, type NextRequest } from 'next/server'
import { withRoute } from '@/lib/http'
import { requireUser } from '@/lib/auth/dal'
import { getLineClient } from '@/modules/line/client'
import { retryMessage } from '@/modules/line/service'
import { toMessageItem } from '@/modules/line/dto'

// [C] app/api/messages/[id]/retry/route.ts: see docs/design.md section 3's
// API table and section 5B step 9. No request body is read: clients must
// still send `content-type: application/json` with body '{}', because
// withRoute treats a POST that carries a body (any content-length other than
// 0) as having one, and rejects a non-JSON content type with 400.

export const runtime = 'nodejs'
export const maxDuration = 30

async function handler(req: NextRequest, ctx: RouteContext<'/api/messages/[id]/retry'>): Promise<Response> {
  const actor = await requireUser(req)
  const { id } = await ctx.params

  const message = await retryMessage({ messageId: id, actor }, { line: getLineClient() })

  return NextResponse.json({ message: toMessageItem(message) })
}

export const POST = withRoute<RouteContext<'/api/messages/[id]/retry'>>('POST /api/messages/[id]/retry', handler)
