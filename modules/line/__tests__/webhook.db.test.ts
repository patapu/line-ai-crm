import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Tx } from '@/lib/db'
import { getDb } from '@/lib/db'
import { DomainError } from '@/lib/errors'
import { encrypt, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { MockLineClient } from '@/modules/line/client.mock'
import { backfillContactProfile } from '@/modules/line/webhook'

// [C-tester] modules/line/__tests__/webhook.db.test.ts: real Postgres
// (crm_test, per vitest.setup.ts). Lane A's findOrCreateContactByLineUserId /
// findOrOpenLeadForContact still throw 'not implemented' (CR-1 pending), so
// this file mocks them with tx-backed fakes that mirror the intended
// contract, per plan-S4.md step 21.

const OWNER_EMAIL = `lanec-owner-${randomBytes(6).toString('hex')}@crm.test`
const PREV_LINE_INBOUND_OWNER_EMAIL = process.env.LINE_INBOUND_OWNER_EMAIL
process.env.LINE_INBOUND_OWNER_EMAIL = OWNER_EMAIL

vi.mock('@/modules/crm/service', () => ({
  findOrCreateContactByLineUserId: vi.fn(async (tx: Tx, input: { lineUserId: string; displayName?: string | null }) => {
    const existing = await tx.contact.findUnique({ where: { lineUserId: input.lineUserId } })
    if (existing) return { contact: existing, created: false }
    const contact = await tx.contact.create({
      data: { firstName: 'LINE user', lineUserId: input.lineUserId, source: 'LINE' },
    })
    return { contact, created: true }
  }),
  findOrOpenLeadForContact: vi.fn(
    async (tx: Tx, input: { contactId: string; ownerId: string; source: 'WEBSITE' | 'MANUAL' | 'LINE' }) => {
      const existing = await tx.lead.findFirst({
        where: { contactId: input.contactId, stage: { notIn: ['WON', 'LOST'] } },
        orderBy: { createdAt: 'desc' },
      })
      if (existing) return { lead: existing, created: false }
      const lead = await tx.lead.create({
        data: { title: 'LINE inquiry', contactId: input.contactId, ownerId: input.ownerId, source: input.source },
      })
      return { lead, created: true }
    },
  ),
}))

const { handleLineWebhook } = await import('@/modules/line/service')
const { findOrCreateContactByLineUserId, findOrOpenLeadForContact } = await import('@/modules/crm/service')

const db = getDb()
const SECRET = 'webhook-db-test-secret'
const line = new MockLineClient(SECRET)

const trackedLineUserIds = new Set<string>()
const trackedWebhookEventIds = new Set<string>()

function newLineUserId(): string {
  const id = 'U' + randomBytes(16).toString('hex')
  trackedLineUserIds.add(id)
  return id
}

function newWebhookEventId(): string {
  const id = 'evt-' + randomUUID()
  trackedWebhookEventIds.add(id)
  return id
}

function messageEvent(opts: { lineUserId: string; text: string; messageId?: string; webhookEventId?: string }) {
  const webhookEventId = opts.webhookEventId ?? newWebhookEventId()
  trackedWebhookEventIds.add(webhookEventId)
  return {
    type: 'message',
    webhookEventId,
    timestamp: Date.now(),
    source: { type: 'user', userId: opts.lineUserId },
    message: { id: opts.messageId ?? randomUUID(), type: 'text', text: opts.text },
  }
}

function followEvent(lineUserId: string) {
  return {
    type: 'follow',
    webhookEventId: newWebhookEventId(),
    timestamp: Date.now(),
    source: { type: 'user', userId: lineUserId },
  }
}

function unfollowEvent(lineUserId: string) {
  return {
    type: 'unfollow',
    webhookEventId: newWebhookEventId(),
    timestamp: Date.now(),
    source: { type: 'user', userId: lineUserId },
  }
}

function stickerEvent(lineUserId: string) {
  return {
    type: 'message',
    webhookEventId: newWebhookEventId(),
    timestamp: Date.now(),
    source: { type: 'user', userId: lineUserId },
    message: { id: randomUUID(), type: 'sticker' },
  }
}

function textWithoutUserIdEvent(text: string) {
  return {
    type: 'message',
    webhookEventId: newWebhookEventId(),
    timestamp: Date.now(),
    message: { id: randomUUID(), type: 'text', text },
  }
}

function signedBody(events: unknown[]): { rawBody: Buffer; signature: string } {
  const raw = Buffer.from(JSON.stringify({ destination: 'Utest', events }), 'utf8')
  return { rawBody: raw, signature: line.sign(raw) }
}

async function callWebhook(events: unknown[], requestId = 'req-' + randomUUID()) {
  const { rawBody, signature } = signedBody(events)
  return handleLineWebhook({ rawBody, signature, requestId }, { line, db })
}

let adminId: string
let salesId: string

beforeAll(async () => {
  const admin = await db.user.create({
    data: {
      email: OWNER_EMAIL,
      name: 'Lane C Test Admin',
      role: 'ADMIN',
      passwordHash: 'not-a-real-hash',
    },
  })
  adminId = admin.id

  const sales = await db.user.create({
    data: {
      email: `lanec-sales-${randomBytes(6).toString('hex')}@crm.test`,
      name: 'Lane C Test Sales',
      role: 'SALES',
      passwordHash: 'not-a-real-hash',
    },
  })
  salesId = sales.id
})

afterAll(async () => {
  const contacts = await db.contact.findMany({
    where: { lineUserId: { in: [...trackedLineUserIds] } },
    select: { id: true },
  })
  const contactIds = contacts.map((c) => c.id)

  const leads = await db.lead.findMany({ where: { contactId: { in: contactIds } }, select: { id: true } })
  const leadIds = leads.map((l) => l.id)

  const webhookEvents = await db.webhookEvent.findMany({
    where: { webhookEventId: { in: [...trackedWebhookEventIds] } },
    select: { id: true },
  })
  const webhookEventRowIds = webhookEvents.map((w) => w.id)

  await db.activity.deleteMany({ where: { leadId: { in: leadIds } } })
  await db.message.deleteMany({
    where: { OR: [{ contactId: { in: contactIds } }, { webhookEventId: { in: webhookEventRowIds } }] },
  })
  await db.webhookEvent.deleteMany({ where: { id: { in: webhookEventRowIds } } })
  await db.lead.deleteMany({ where: { id: { in: leadIds } } })
  await db.contact.deleteMany({ where: { id: { in: contactIds } } })
  await db.user.deleteMany({ where: { id: { in: [adminId, salesId] } } })

  if (PREV_LINE_INBOUND_OWNER_EMAIL === undefined) {
    delete process.env.LINE_INBOUND_OWNER_EMAIL
  } else {
    process.env.LINE_INBOUND_OWNER_EMAIL = PREV_LINE_INBOUND_OWNER_EMAIL
  }
})

describe('cases 1-3: a valid text event, then dedupe by webhookEventId, then dedupe by lineMessageId', () => {
  const lineUserId = newLineUserId()
  const webhookEventId = newWebhookEventId()
  const messageId = randomUUID()
  const text = 'hello from a synthetic LINE user'

  it('case 1: a valid text event creates contact, lead, message, and an activity', async () => {
    const outcome = await callWebhook([messageEvent({ lineUserId, text, messageId, webhookEventId })])
    expect(outcome).toEqual({ status: 200, processed: 1, duplicates: 0, ignored: 0, failed: 0 })

    const row = await db.webhookEvent.findUnique({ where: { webhookEventId } })
    expect(row?.status).toBe('PROCESSED')
    expect(row?.processedAt).not.toBeNull()

    const contact = await db.contact.findUnique({ where: { lineUserId } })
    expect(contact).not.toBeNull()
    expect(contact?.source).toBe('LINE')

    const lead = await db.lead.findFirst({ where: { contactId: contact!.id } })
    expect(lead).not.toBeNull()
    expect(lead?.ownerId).toBe(adminId)
    expect(lead?.source).toBe('LINE')

    const message = await db.message.findUnique({ where: { lineMessageId: messageId } })
    expect(message).toMatchObject({
      channel: 'LINE',
      direction: 'INBOUND',
      status: 'RECEIVED',
      contactId: contact!.id,
      leadId: lead!.id,
    })
    expect(message?.webhookEventId).toBe(row!.id)

    const activity = await db.activity.findFirst({
      where: { leadId: lead!.id, type: 'CONTACT_CREATED_FROM_LINE' },
    })
    expect(activity).not.toBeNull()
    expect(activity?.actorId).toBeNull()
  })

  it('case 2: the same body delivered again is a webhookEventId duplicate, no new rows', async () => {
    const before = {
      webhookEvents: await db.webhookEvent.count({ where: { webhookEventId } }),
      contacts: await db.contact.count({ where: { lineUserId } }),
      messages: await db.message.count({ where: { lineMessageId: messageId } }),
    }

    const outcome = await callWebhook([messageEvent({ lineUserId, text, messageId, webhookEventId })])
    expect(outcome).toEqual({ status: 200, processed: 0, duplicates: 1, ignored: 0, failed: 0 })

    expect(await db.webhookEvent.count({ where: { webhookEventId } })).toBe(before.webhookEvents)
    expect(await db.contact.count({ where: { lineUserId } })).toBe(before.contacts)
    expect(await db.message.count({ where: { lineMessageId: messageId } })).toBe(before.messages)
  })

  it('case 3: a new webhookEventId with the same message.id is a lineMessageId duplicate, no new message', async () => {
    const secondWebhookEventId = newWebhookEventId()
    const messagesBefore = await db.message.count({ where: { lineMessageId: messageId } })

    const outcome = await callWebhook([messageEvent({ lineUserId, text, messageId, webhookEventId: secondWebhookEventId })])
    expect(outcome).toEqual({ status: 200, processed: 0, duplicates: 1, ignored: 0, failed: 0 })

    const row = await db.webhookEvent.findUnique({ where: { webhookEventId: secondWebhookEventId } })
    expect(row?.status).toBe('PROCESSED')
    expect(await db.message.count({ where: { lineMessageId: messageId } })).toBe(messagesBefore)
  })
})

describe('case 4: two messages from one new user in one batch', () => {
  it('creates 1 contact, 1 lead, and 2 messages', async () => {
    const lineUserId = newLineUserId()
    const outcome = await callWebhook([
      messageEvent({ lineUserId, text: 'first message' }),
      messageEvent({ lineUserId, text: 'second message' }),
    ])
    expect(outcome).toEqual({ status: 200, processed: 2, duplicates: 0, ignored: 0, failed: 0 })

    expect(await db.contact.count({ where: { lineUserId } })).toBe(1)
    const contact = await db.contact.findUniqueOrThrow({ where: { lineUserId } })
    expect(await db.lead.count({ where: { contactId: contact.id } })).toBe(1)
    expect(await db.message.count({ where: { contactId: contact.id } })).toBe(2)
  })
})

describe('case 5: a follow event creates a contact but no lead and no message', () => {
  it('creates only a contact', async () => {
    const lineUserId = newLineUserId()
    const outcome = await callWebhook([followEvent(lineUserId)])
    expect(outcome).toEqual({ status: 200, processed: 1, duplicates: 0, ignored: 0, failed: 0 })

    const contact = await db.contact.findUnique({ where: { lineUserId } })
    expect(contact).not.toBeNull()
    expect(await db.lead.count({ where: { contactId: contact!.id } })).toBe(0)
    expect(await db.message.count({ where: { contactId: contact!.id } })).toBe(0)
  })
})

describe('case 6: unfollow, a sticker, and text with no userId are all ignored', () => {
  it('marks all three events IGNORED with their payload stored', async () => {
    const lineUserId = newLineUserId()
    const events = [unfollowEvent(lineUserId), stickerEvent(lineUserId), textWithoutUserIdEvent('nobody reads this')]
    const outcome = await callWebhook(events)
    expect(outcome).toEqual({ status: 200, processed: 0, duplicates: 0, ignored: 3, failed: 0 })

    for (const event of events) {
      const row = await db.webhookEvent.findUnique({ where: { webhookEventId: event.webhookEventId } })
      expect(row?.status).toBe('IGNORED')
      expect(row?.processedAt).not.toBeNull()
      expect(row?.payload).toMatchObject({ type: event.type })
    }
  })
})

describe('case 7: a transaction failure rolls back, is recorded FAILED, and reprocesses cleanly on redelivery', () => {
  it('rolls back the contact, marks the row FAILED without leaking the message text, then succeeds on redelivery', async () => {
    const lineUserId = newLineUserId()
    const webhookEventId = newWebhookEventId()
    const messageId = randomUUID()
    const secretText = 'do-not-leak-this-inbound-text'

    vi.mocked(findOrOpenLeadForContact).mockImplementationOnce(() => {
      throw new DomainError('INTERNAL', 'forced-failure-case7')
    })

    const outcome = await callWebhook([messageEvent({ lineUserId, text: secretText, messageId, webhookEventId })])
    expect(outcome).toEqual({ status: 500, processed: 0, duplicates: 0, ignored: 0, failed: 1 })

    const row = await db.webhookEvent.findUnique({ where: { webhookEventId } })
    expect(row?.status).toBe('FAILED')
    expect(row?.error).not.toBeNull()
    expect(row?.error).not.toContain(secretText)

    expect(await db.contact.count({ where: { lineUserId } })).toBe(0)

    const redelivered = await callWebhook([messageEvent({ lineUserId, text: secretText, messageId, webhookEventId })])
    expect(redelivered).toEqual({ status: 200, processed: 1, duplicates: 0, ignored: 0, failed: 0 })
    expect(await db.message.count({ where: { lineMessageId: messageId } })).toBe(1)
  })
})

describe('case 8: a mixed batch of one failing and one good event, then redelivery', () => {
  it('gives 500 for the batch, then reports the good one as a duplicate on redelivery', async () => {
    const badUserId = newLineUserId()
    const goodUserId = newLineUserId()
    const badWebhookEventId = newWebhookEventId()
    const goodWebhookEventId = newWebhookEventId()
    const badMessageId = randomUUID()
    const goodMessageId = randomUUID()

    vi.mocked(findOrOpenLeadForContact).mockImplementationOnce(() => {
      throw new DomainError('INTERNAL', 'forced-failure-case8')
    })

    const outcome = await callWebhook([
      messageEvent({ lineUserId: badUserId, text: 'bad', messageId: badMessageId, webhookEventId: badWebhookEventId }),
      messageEvent({ lineUserId: goodUserId, text: 'good', messageId: goodMessageId, webhookEventId: goodWebhookEventId }),
    ])
    expect(outcome).toEqual({ status: 500, processed: 1, duplicates: 0, ignored: 0, failed: 1 })

    const redelivered = await callWebhook([
      messageEvent({ lineUserId: badUserId, text: 'bad', messageId: badMessageId, webhookEventId: badWebhookEventId }),
      messageEvent({ lineUserId: goodUserId, text: 'good', messageId: goodMessageId, webhookEventId: goodWebhookEventId }),
    ])
    expect(redelivered).toEqual({ status: 200, processed: 1, duplicates: 1, ignored: 0, failed: 0 })
  })
})

describe('case 9: concurrent deliveries for one new user prove the advisory lock', () => {
  it('blocks the second delivery from entering findOrCreateContactByLineUserId until the first releases its barrier, then gives exactly 1 contact, 1 lead, and 2 messages', async () => {
    const lineUserId = newLineUserId()
    const eventA = messageEvent({ lineUserId, text: 'concurrent A' })
    const eventB = messageEvent({ lineUserId, text: 'concurrent B' })

    const baseImpl = vi.mocked(findOrCreateContactByLineUserId).getMockImplementation()
    if (!baseImpl) throw new Error('test setup error: no base mock implementation found')
    vi.mocked(findOrCreateContactByLineUserId).mockClear()

    let releaseBarrier!: () => void
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve
    })
    let firstEnteredResolve!: () => void
    const firstEntered = new Promise<void>((resolve) => {
      firstEnteredResolve = resolve
    })

    // The FIRST call to findOrCreateContactByLineUserId (made by whichever
    // delivery wins the pg advisory lock) parks on the barrier. Because the
    // lock is held for the whole transaction, the second delivery cannot
    // reach findOrCreateContactByLineUserId at all until the barrier is
    // released and the first transaction commits (releasing the lock).
    vi.mocked(findOrCreateContactByLineUserId).mockImplementationOnce(async (tx, input) => {
      firstEnteredResolve()
      await barrier
      return baseImpl(tx, input)
    })

    const promiseA = callWebhook([eventA])
    const promiseB = callWebhook([eventB])

    await firstEntered
    // Short, well under Prisma's interactive tx timeout: proves the second
    // delivery has NOT entered findOrCreateContactByLineUserId while the
    // first still holds the advisory lock.
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(findOrCreateContactByLineUserId).toHaveBeenCalledTimes(1)

    releaseBarrier()

    const [outcomeA, outcomeB] = await Promise.all([promiseA, promiseB])
    expect(outcomeA).toEqual({ status: 200, processed: 1, duplicates: 0, ignored: 0, failed: 0 })
    expect(outcomeB).toEqual({ status: 200, processed: 1, duplicates: 0, ignored: 0, failed: 0 })
    expect(findOrCreateContactByLineUserId).toHaveBeenCalledTimes(2)

    expect(await db.contact.count({ where: { lineUserId } })).toBe(1)
    const contact = await db.contact.findUniqueOrThrow({ where: { lineUserId } })
    expect(await db.lead.count({ where: { contactId: contact.id } })).toBe(1)
    expect(await db.message.count({ where: { contactId: contact.id } })).toBe(2)
  })
})

describe('case 10: a pre-inserted RECEIVED row is reprocessed, not treated as a duplicate', () => {
  it('reuses the existing row instead of creating a second one', async () => {
    const lineUserId = newLineUserId()
    const webhookEventId = newWebhookEventId()
    const messageId = randomUUID()

    const preInserted = await db.webhookEvent.create({
      data: {
        webhookEventId,
        type: 'message',
        lineUserId,
        isRedelivery: false,
        eventTimestamp: new Date(),
        payload: { type: 'message', webhookEventId },
        status: 'RECEIVED',
      },
    })

    const outcome = await callWebhook([messageEvent({ lineUserId, text: 'reprocess me', messageId, webhookEventId })])
    expect(outcome).toEqual({ status: 200, processed: 1, duplicates: 0, ignored: 0, failed: 0 })

    expect(await db.webhookEvent.count({ where: { webhookEventId } })).toBe(1)
    const row = await db.webhookEvent.findUniqueOrThrow({ where: { webhookEventId } })
    expect(row.id).toBe(preInserted.id)
    expect(row.status).toBe('PROCESSED')
  })
})

describe('case 11: backfillContactProfile', () => {
  it('sets a Mock-prefixed display name on a contact with none', async () => {
    const lineUserId = newLineUserId()
    const contact = await db.contact.create({
      data: { firstName: 'LINE user', lineUserId, source: 'LINE' },
    })

    await backfillContactProfile(db, line, { contactId: contact.id, lineUserId })

    const updated = await db.contact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(updated.lineDisplayName).toBe('Mock ' + lineUserId.slice(-4))
  })

  it('never overwrites an existing lineDisplayName', async () => {
    const lineUserId = newLineUserId()
    const contact = await db.contact.create({
      data: { firstName: 'LINE user', lineUserId, source: 'LINE', lineDisplayName: 'Existing Name' },
    })

    await backfillContactProfile(db, line, { contactId: contact.id, lineUserId })

    const updated = await db.contact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(updated.lineDisplayName).toBe('Existing Name')
  })
})

describe('case 12: the simulate route', () => {
  const APP_ORIGIN = 'http://localhost:3000'

  async function cookieFor(id: string, role: 'ADMIN' | 'SALES', name: string): Promise<string> {
    return encrypt({ sub: id, role, name })
  }

  function simulateRequest(body: unknown, cookie?: string): NextRequest {
    const headers: Record<string, string> = {
      origin: APP_ORIGIN,
      'content-type': 'application/json',
    }
    if (cookie) headers.cookie = `${SESSION_COOKIE_NAME}=${cookie}`
    return new NextRequest('http://localhost:3000/api/dev/line/simulate', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  }

  it('returns 200 with processed 1 for an admin session', async () => {
    const { POST } = await import('@/app/api/dev/line/simulate/route')
    const token = await cookieFor(adminId, 'ADMIN', 'Lane C Test Admin')
    const req = simulateRequest({ event: 'message', text: 'simulated from admin' }, token)
    const res = await POST(req, {})
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      outcome: { processed: number }
      lineUserId: string
      webhookEventId: string
    }
    expect(json.outcome.processed).toBe(1)
    trackedLineUserIds.add(json.lineUserId)
    trackedWebhookEventIds.add(json.webhookEventId)
  })

  it('returns 403 for a SALES session', async () => {
    const { POST } = await import('@/app/api/dev/line/simulate/route')
    const token = await cookieFor(salesId, 'SALES', 'Lane C Test Sales')
    const req = simulateRequest({ event: 'message', text: 'simulated from sales' }, token)
    const res = await POST(req, {})
    expect(res.status).toBe(403)
  })

  it('returns 401 with no cookie', async () => {
    const { POST } = await import('@/app/api/dev/line/simulate/route')
    const req = simulateRequest({ event: 'message', text: 'simulated with no cookie' })
    const res = await POST(req, {})
    expect(res.status).toBe(401)
  })
})
