import { NextResponse, type NextRequest } from 'next/server'
import { withRoute } from '@/lib/http'
import { DomainError } from '@/lib/errors'
import { getLineClient } from '@/modules/line/client'
import { handleLineWebhook } from '@/modules/line/service'
import { MAX_WEBHOOK_BODY_BYTES, resolveRequestId } from '@/modules/line/webhook'

// [C] app/api/line/webhook/route.ts: see docs/design.md section 3's API table
// and section 5A. Public (no session cookie): the LINE signature check is
// the auth for this route instead of the Origin/CSRF check withRoute would
// otherwise run.

export const runtime = 'nodejs'
export const maxDuration = 10

function payloadTooLarge(requestId: string): Response {
  return NextResponse.json(
    { error: { code: 'VALIDATION_FAILED', message: 'payload too large', requestId } },
    { status: 413 },
  )
}

/**
 * Reads the body as a stream instead of req.arrayBuffer(), so a request with
 * no content-length header (chunked transfer) cannot make us buffer an
 * unbounded payload before the size check runs: the running byte count is
 * checked after every chunk, and the reader is cancelled the moment it goes
 * over the limit. A null body (no bytes at all) reads as an empty Buffer.
 */
async function readBodyWithLimit(req: NextRequest, requestId: string): Promise<Buffer | Response> {
  if (!req.body) {
    return Buffer.alloc(0)
  }

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    total += value.byteLength
    if (total > MAX_WEBHOOK_BODY_BYTES) {
      await reader.cancel().catch(() => {})
      return payloadTooLarge(requestId)
    }
    chunks.push(value)
  }

  return Buffer.concat(chunks)
}

async function handler(req: NextRequest): Promise<Response> {
  const requestId = resolveRequestId(req.headers)

  const contentLength = req.headers.get('content-length')
  if (contentLength !== null && Number(contentLength) > MAX_WEBHOOK_BODY_BYTES) {
    return payloadTooLarge(requestId)
  }

  const bodyOrTooLarge = await readBodyWithLimit(req, requestId)
  if (bodyOrTooLarge instanceof Response) {
    return bodyOrTooLarge
  }
  const rawBody = bodyOrTooLarge
  const outcome = await handleLineWebhook(
    { rawBody, signature: req.headers.get('x-line-signature'), requestId },
    { line: getLineClient() },
  )

  switch (outcome.status) {
    case 200:
      return NextResponse.json({
        ok: true,
        processed: outcome.processed,
        duplicates: outcome.duplicates,
        ignored: outcome.ignored,
        failed: outcome.failed,
      })
    case 401:
      throw new DomainError('UNAUTHENTICATED', 'invalid signature')
    case 400:
      throw new DomainError('VALIDATION_FAILED', 'invalid webhook body')
    case 413:
      return payloadTooLarge(requestId)
    case 500:
    default:
      throw new DomainError('INTERNAL', 'one or more webhook events failed')
  }
}

export const POST = withRoute('POST /api/line/webhook', handler, { public: true })
