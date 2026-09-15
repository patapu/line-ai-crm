import { NextResponse, type NextRequest } from 'next/server'
import { withRoute, readJson } from '@/lib/http'
import { DomainError } from '@/lib/errors'
import { requireUser } from '@/lib/auth/dal'
import { MessageSend } from '@/lib/contracts/line'
import { getLineClient } from '@/modules/line/client'
import { sendLineMessage, logManualMessage } from '@/modules/line/service'
import { toMessageItem } from '@/modules/line/dto'

// [C] app/api/leads/[id]/messages/route.ts: see docs/design.md section 3's
// API table and section 5B step 10. LINE messages push through
// sendLineMessage (enqueue + deliver); MANUAL messages are a plain log entry
// with no network call. Both outcomes answer 200: LINE can come back SENT or
// FAILED, MANUAL always LOGGED. The caller reads message.status to see what
// happened.

export const runtime = 'nodejs'
export const maxDuration = 30

async function handler(req: NextRequest, ctx: RouteContext<'/api/leads/[id]/messages'>): Promise<Response> {
  const actor = await requireUser(req)
  const { id } = await ctx.params
  const input = await readJson(req, MessageSend)

  if (input.channel === 'LINE' && input.direction === 'INBOUND') {
    throw new DomainError('VALIDATION_FAILED', 'validation failed', {
      direction: ['LINE messages can only be OUTBOUND'],
    })
  }

  const message =
    input.channel === 'LINE'
      ? await sendLineMessage({ leadId: id, text: input.text, actor }, { line: getLineClient() })
      : await logManualMessage({ leadId: id, text: input.text, direction: input.direction, actor })

  return NextResponse.json({ message: toMessageItem(message) })
}

export const POST = withRoute<RouteContext<'/api/leads/[id]/messages'>>('POST /api/leads/[id]/messages', handler)
