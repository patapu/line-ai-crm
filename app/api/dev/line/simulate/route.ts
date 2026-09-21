import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withRoute, readJson } from '@/lib/http'
import { DomainError } from '@/lib/errors'
import { getEnv } from '@/lib/env'
import { requireUser } from '@/lib/auth/dal'
import { getLineClient } from '@/modules/line/client'
import { MockLineClient } from '@/modules/line/client.mock'
import { handleLineWebhook } from '@/modules/line/service'
import { resolveRequestId, CONTROL_OR_INVISIBLE_CHAR_CLASS } from '@/modules/line/webhook'

// [C] app/api/dev/line/simulate/route.ts: see docs/design.md section 3's API
// table. Admin-only dev tool that drives the real signed webhook path
// (handleLineWebhook), so it exercises the same code as a real LINE
// delivery. 404s outside LINE_MODE=mock, so it cannot be pointed at a live
// channel, and 404s again if the memoized LINE client is not a
// MockLineClient (LINE_MODE=mock but getLineClient() was already cached as
// live in this process). `displayName` is optional: when set, it seeds the
// mock client's getProfile() for this lineUserId, so the profile backfill
// (scheduled inside handleLineWebhook via after()) picks it up. The name
// only shows up after a refresh, since the backfill runs in after(), and it
// only takes effect when this call is the one that creates the contact
// (backfillContactProfile never overwrites an existing lineDisplayName).

export const runtime = 'nodejs'
export const maxDuration = 10

// Rejects the same C0/C1 control and invisible/bidi character set that
// modules/line/webhook.ts's normalizeDisplayName strips at backfill time, so
// a dev-tool operator gets the same 400 instead of a silently sanitized name.
// No 'g' flag: this constant is module-level and reused across requests, and
// a global regex's .test() carries lastIndex state between calls.
const DISPLAY_NAME_REJECT_RE = new RegExp('[' + CONTROL_OR_INVISIBLE_CHAR_CLASS + ']')

const SimulateInput = z
  .object({
    event: z.enum(['message', 'follow']).default('message'),
    text: z.string().trim().min(1).max(1000).optional(),
    lineUserId: z
      .string()
      .regex(/^U[0-9a-f]{32}$/)
      .optional(),
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((s) => !DISPLAY_NAME_REJECT_RE.test(s), {
        message: 'displayName must not contain control or invisible characters',
      })
      .optional(),
  })
  .refine((v) => v.event !== 'message' || !!v.text, {
    path: ['text'],
    message: 'text is required for a message event',
  })

async function handler(req: NextRequest): Promise<Response> {
  if (getEnv().LINE_MODE !== 'mock') {
    throw new DomainError('NOT_FOUND', 'not found')
  }

  const actor = await requireUser(req)
  if (actor.role !== 'ADMIN') {
    throw new DomainError('FORBIDDEN', 'admin only')
  }

  const input = await readJson(req, SimulateInput)

  const line = getLineClient()
  if (!(line instanceof MockLineClient)) {
    throw new DomainError('NOT_FOUND', 'not found')
  }

  const lineUserId = input.lineUserId ?? 'U' + randomBytes(16).toString('hex')
  const webhookEventId = 'sim-' + randomUUID()

  if (input.displayName) line.setProfileName(lineUserId, input.displayName)

  const baseEvent = {
    type: input.event,
    mode: 'active' as const,
    timestamp: Date.now(),
    webhookEventId,
    deliveryContext: { isRedelivery: false },
    source: { type: 'user', userId: lineUserId },
  }

  const event =
    input.event === 'message'
      ? {
          ...baseEvent,
          message: { id: `${Date.now()}${randomInt(100000, 999999)}`, type: 'text', text: input.text },
        }
      : baseEvent

  const body = { destination: 'Usimulated', events: [event] }
  const raw = Buffer.from(JSON.stringify(body))

  const outcome = await handleLineWebhook(
    { rawBody: raw, signature: line.sign(raw), requestId: resolveRequestId(req.headers) },
    { line },
  )

  return NextResponse.json({ outcome, lineUserId, webhookEventId })
}

export const POST = withRoute('POST /api/dev/line/simulate', handler)
