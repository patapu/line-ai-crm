import type { NextRequest } from 'next/server'
import { withRoute, readJson } from '@/lib/http'
import { requireUser } from '@/lib/auth/dal'
import { DomainError } from '@/lib/errors'
import { IdSchema } from '@/lib/contracts/common'
import { SuggestionApprove } from '@/lib/contracts/copilot'
import { approveSuggestion, toApprovedMessageView, toSuggestionView } from '@/modules/copilot/service'
import { getLineClient } from '@/modules/line/client'
import type { LineClient, LineOutboundMessage, LineProfile, PushResult } from '@/modules/line/types'

// [B] app/api/suggestions/[id]/approve/route.ts: lane owned. POST only, see
// docs/design.md section 3's API table and section 5B's approve flow.
// maxDuration 30: Tx A (DB only) plus, when `send` is true, the outside-tx
// LINE push in deliverQueuedMessage.

export const runtime = 'nodejs'
export const maxDuration = 30

function parseId(raw: string): string {
  const parsed = IdSchema.safeParse(raw)
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'invalid id', { id: ['must be a cuid'] })
  }
  return parsed.data
}

/**
 * `approveSuggestion` always needs a LineClient in its deps shape, even on a
 * `send: false` approve (the common case), which never calls any of these
 * methods. Wrapping getLineClient() behind a memoized getter means that
 * common case never touches Lane C's factory (and therefore never throws if
 * LINE isn't configured) at all: the real client is only constructed the
 * first time one of these methods actually runs.
 */
function lazyLineClient(): LineClient {
  let client: LineClient | undefined
  const resolve = (): LineClient => (client ??= getLineClient())

  return {
    get mode() {
      return resolve().mode
    },
    verifySignature(rawBody: Buffer, signature: string | null): boolean {
      return resolve().verifySignature(rawBody, signature)
    },
    push(to: string, messages: LineOutboundMessage[], retryKey: string): Promise<PushResult> {
      return resolve().push(to, messages, retryKey)
    },
    getProfile(userId: string): Promise<LineProfile | null> {
      return resolve().getProfile(userId)
    },
  }
}

export const POST = withRoute(
  'POST /api/suggestions/[id]/approve',
  async (req: NextRequest, ctx: RouteContext<'/api/suggestions/[id]/approve'>) => {
    const actor = await requireUser(req)

    const { id: rawId } = await ctx.params
    const suggestionId = parseId(rawId)
    const input = await readJson(req, SuggestionApprove)

    const { suggestion, message } = await approveSuggestion(
      { suggestionId, actor, send: input.send, replyText: input.replyText, applyScore: input.applyScore },
      { line: lazyLineClient() },
    )

    return Response.json(
      { suggestion: toSuggestionView(suggestion), message: message ? toApprovedMessageView(message) : null },
      { status: 200 },
    )
  },
)
