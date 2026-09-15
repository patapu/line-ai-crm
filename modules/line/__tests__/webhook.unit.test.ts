import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Db } from '@/lib/db'
import { DomainError } from '@/lib/errors'
import type { LineClient, PushResult, LineProfile } from '@/modules/line/types'
import { MockLineClient } from '@/modules/line/client.mock'
import { sanitizeError } from '@/modules/line/webhook'

// [C-tester] modules/line/__tests__/webhook.unit.test.ts: no DB needed.
// Covers plan step 21's webhook.unit.test.ts cases: body size, signature
// checks (with no DB touch and no CRM calls), malformed/invalid body, an
// empty events array, and the public route's own 401/413 handling.

vi.mock('@/modules/crm/service', () => ({
  findOrCreateContactByLineUserId: vi.fn(() => {
    throw new Error('crm/service.findOrCreateContactByLineUserId should never be called before signature success')
  }),
  findOrOpenLeadForContact: vi.fn(() => {
    throw new Error('crm/service.findOrOpenLeadForContact should never be called before signature success')
  }),
}))

// Imported after the mock so the mocked module is in place first.
const { handleLineWebhook } = await import('@/modules/line/service')
const { findOrCreateContactByLineUserId, findOrOpenLeadForContact } = await import('@/modules/crm/service')

/** Throws on any property access: proves the code path never touches the DB. */
function throwingDb(): Db {
  return new Proxy(
    {},
    {
      get() {
        throw new Error('db touched')
      },
    },
  ) as unknown as Db
}

function fakeLine(overrides: Partial<LineClient> = {}): LineClient {
  return {
    mode: 'mock',
    verifySignature: () => true,
    push: async (): Promise<PushResult> => ({ ok: true, httpStatus: 200, duplicate: false, requestId: 'mock-1' }),
    getProfile: async (): Promise<LineProfile | null> => null,
    ...overrides,
  }
}

let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
  errorSpy.mockRestore()
  vi.clearAllMocks()
})

function allLoggedText(): string {
  const logLines = logSpy.mock.calls.map((c: unknown[]) => String(c[0]))
  const errorLines = errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))
  return [...logLines, ...errorLines].join('\n')
}

describe('handleLineWebhook: body size', () => {
  it('returns 413 for a body over MAX_WEBHOOK_BODY_BYTES, with no DB access', async () => {
    const oversized = Buffer.alloc(1024 * 1024 + 1, 'a')
    const outcome = await handleLineWebhook(
      { rawBody: oversized, signature: 'whatever', requestId: 'req-1' },
      { line: fakeLine(), db: throwingDb() },
    )
    expect(outcome).toEqual({ status: 413, processed: 0, duplicates: 0, ignored: 0, failed: 0 })
    expect(findOrCreateContactByLineUserId).not.toHaveBeenCalled()
    expect(findOrOpenLeadForContact).not.toHaveBeenCalled()
  })
})

describe('handleLineWebhook: signature', () => {
  it('returns 401 for a signature verifySignature rejects, with no DB access and CRM never called', async () => {
    const body = Buffer.from(JSON.stringify({ destination: 'U1', events: [] }), 'utf8')
    const outcome = await handleLineWebhook(
      { rawBody: body, signature: 'wrong-signature', requestId: 'req-2' },
      { line: fakeLine({ verifySignature: () => false }), db: throwingDb() },
    )
    expect(outcome).toEqual({ status: 401, processed: 0, duplicates: 0, ignored: 0, failed: 0 })
    expect(findOrCreateContactByLineUserId).not.toHaveBeenCalled()
    expect(findOrOpenLeadForContact).not.toHaveBeenCalled()
  })

  it('returns 401 for a tampered (present but invalid) signature', async () => {
    const body = Buffer.from(JSON.stringify({ destination: 'U1', events: [] }), 'utf8')
    const outcome = await handleLineWebhook(
      { rawBody: body, signature: 'tampered-value', requestId: 'req-3' },
      { line: fakeLine({ verifySignature: () => false }), db: throwingDb() },
    )
    expect(outcome.status).toBe(401)
  })

  it('returns 401 for a null signature', async () => {
    const body = Buffer.from(JSON.stringify({ destination: 'U1', events: [] }), 'utf8')
    const outcome = await handleLineWebhook(
      { rawBody: body, signature: null, requestId: 'req-4' },
      { line: fakeLine({ verifySignature: () => false }), db: throwingDb() },
    )
    expect(outcome.status).toBe(401)
  })

  it('logs signature_invalid with no secret, signature value, or body text', async () => {
    // A real MockLineClient with a known secret, so verifySignature runs the
    // actual HMAC check instead of a stub always returning false: the
    // signature below is computed over a DIFFERENT body, so it genuinely
    // fails verification against `body`.
    const secret = 'super-secret-signature-value-should-not-leak'
    const client = new MockLineClient(secret)
    const bodyText = 'do not leak this text'
    const body = Buffer.from(JSON.stringify({ destination: 'U1', events: [{ text: bodyText }] }), 'utf8')
    const wrongSignature = client.sign(Buffer.from('a different body entirely', 'utf8'))
    expect(client.verifySignature(body, wrongSignature)).toBe(false)

    await handleLineWebhook(
      { rawBody: body, signature: wrongSignature, requestId: 'req-5' },
      { line: client, db: throwingDb() },
    )
    const logged = allLoggedText()
    expect(logged).toContain('line.webhook.signature_invalid')
    expect(logged).not.toContain(secret)
    expect(logged).not.toContain(wrongSignature)
    expect(logged).not.toContain(bodyText)
    // sigPresent, not hasSignature: the redaction regex matches "signature" in
    // a field NAME, so a field literally named hasSignature would be blanked.
    expect(logged).toContain('sigPresent')
  })
})

describe('handleLineWebhook: body parsing', () => {
  it('returns 400 for malformed JSON', async () => {
    const body = Buffer.from('{not json', 'utf8')
    const outcome = await handleLineWebhook(
      { rawBody: body, signature: 'sig', requestId: 'req-6' },
      { line: fakeLine(), db: throwingDb() },
    )
    expect(outcome).toEqual({ status: 400, processed: 0, duplicates: 0, ignored: 0, failed: 0 })
  })

  it('returns 400 when the JSON does not match the LineWebhookBody schema', async () => {
    const body = Buffer.from(JSON.stringify({ nope: true }), 'utf8')
    const outcome = await handleLineWebhook(
      { rawBody: body, signature: 'sig', requestId: 'req-7' },
      { line: fakeLine(), db: throwingDb() },
    )
    expect(outcome).toEqual({ status: 400, processed: 0, duplicates: 0, ignored: 0, failed: 0 })
  })

  it('returns 200 with all zeros for an empty events array', async () => {
    const body = Buffer.from(JSON.stringify({ destination: 'U1', events: [] }), 'utf8')
    const outcome = await handleLineWebhook(
      { rawBody: body, signature: 'sig', requestId: 'req-8' },
      { line: fakeLine(), db: throwingDb() },
    )
    expect(outcome).toEqual({ status: 200, processed: 0, duplicates: 0, ignored: 0, failed: 0 })
  })
})

describe('POST /api/line/webhook route: signature and size', () => {
  it('returns 401 UNAUTHENTICATED when no x-line-signature header is present', async () => {
    const { POST } = await import('@/app/api/line/webhook/route')
    const body = JSON.stringify({ destination: 'U1', events: [] })
    const req = new NextRequest('http://localhost:3000/api/line/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    const res = await POST(req, {})
    expect(res.status).toBe(401)
    const json = (await res.json()) as { error: { code: string } }
    expect(json.error.code).toBe('UNAUTHENTICATED')
  })

  it('returns 413 when content-length declares a body over the limit', async () => {
    const { POST } = await import('@/app/api/line/webhook/route')
    const req = new NextRequest('http://localhost:3000/api/line/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(2 * 1024 * 1024),
      },
      body: '{}',
    })
    const res = await POST(req, {})
    expect(res.status).toBe(413)
  })

  it('returns 413 for a chunked body over the limit with no content-length header at all', async () => {
    const { POST } = await import('@/app/api/line/webhook/route')
    const chunkSize = 300 * 1024
    const totalChunks = 5 // 1.5 MB streamed, over the 1 MB cap, in chunks with no declared length
    let sentChunks = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sentChunks >= totalChunks) {
          controller.close()
          return
        }
        sentChunks++
        controller.enqueue(new Uint8Array(chunkSize).fill(97))
      },
    })
    const req = new NextRequest(
      'http://localhost:3000/api/line/webhook',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: stream,
        duplex: 'half',
      } as unknown as ConstructorParameters<typeof NextRequest>[1],
    )
    expect(req.headers.get('content-length')).toBeNull()

    const res = await POST(req, {})
    expect(res.status).toBe(413)
    expect(findOrCreateContactByLineUserId).not.toHaveBeenCalled()
    expect(findOrOpenLeadForContact).not.toHaveBeenCalled()
  })
})

describe('sanitizeError', () => {
  it('formats a DomainError as CODE: message', () => {
    expect(sanitizeError(new DomainError('CONFLICT', 'oops'))).toBe('CONFLICT: oops')
  })

  it('formats a Prisma-like error code (P followed by 4 digits) as PRISMA <code>', () => {
    expect(sanitizeError({ code: 'P2002' })).toBe('PRISMA P2002')
  })

  it('formats a non-Prisma string error code (e.g. a Node system error) as ERR <code>', () => {
    expect(sanitizeError({ code: 'ECONNREFUSED' })).toBe('ERR ECONNREFUSED')
  })

  it('falls back to the constructor name for a plain Error with no code', () => {
    expect(sanitizeError(new TypeError('boom'))).toBe('TypeError')
  })

  it('falls back to "unknown error" for a non-object, non-Error value', () => {
    expect(sanitizeError('just a string')).toBe('unknown error')
    expect(sanitizeError(null)).toBe('unknown error')
    expect(sanitizeError(undefined)).toBe('unknown error')
  })

  it('truncates the result to 500 characters', () => {
    const long = 'x'.repeat(1000)
    expect(sanitizeError(new DomainError('INTERNAL', long))).toHaveLength(500)
  })
})

describe('handleLineWebhook: a FAILED marking never overwrites an already-PROCESSED row', () => {
  it('updateMany is called with a status-not-PROCESSED guard when processing throws', async () => {
    const rowId = 'row-guard-1'
    const updateManyCalls: unknown[] = []
    const fakeDb = {
      webhookEvent: {
        create: vi.fn(async () => ({ id: rowId })),
        findUnique: vi.fn(async () => null),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async (args: unknown) => {
          updateManyCalls.push(args)
          return { count: 0 }
        }),
      },
      $transaction: vi.fn(async () => {
        throw new Error('simulated processing failure')
      }),
    } as unknown as Db

    const body = Buffer.from(
      JSON.stringify({
        destination: 'U1',
        events: [
          {
            type: 'message',
            webhookEventId: 'evt-guard-1',
            timestamp: Date.now(),
            source: { type: 'user', userId: 'Ufakeuserforguardtest0000000000' },
            message: { id: 'msg-guard-1', type: 'text', text: 'hello' },
          },
        ],
      }),
      'utf8',
    )

    const outcome = await handleLineWebhook(
      { rawBody: body, signature: 'sig', requestId: 'req-guard' },
      { line: fakeLine(), db: fakeDb },
    )

    expect(outcome).toEqual({ status: 500, processed: 0, duplicates: 0, ignored: 0, failed: 1 })
    expect(updateManyCalls).toHaveLength(1)
    expect(updateManyCalls[0]).toMatchObject({
      where: { id: rowId, status: { not: 'PROCESSED' } },
      data: { status: 'FAILED' },
    })
  })
})
