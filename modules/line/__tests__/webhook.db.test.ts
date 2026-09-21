import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { DomainError } from '@/lib/errors'
import { encrypt, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import type { LineClient } from '@/modules/line/types'
import { MockLineClient } from '@/modules/line/client.mock'
import { backfillContactProfile } from '@/modules/line/webhook'

// [C-tester] modules/line/__tests__/webhook.db.test.ts: real Postgres
// (crm_test, per vitest.setup.ts). These tests run against Lane A's real
// CRM functions (modules/crm/service.ts): findOrCreateContactByLineUserId
// and findOrOpenLeadForContact are mocked only as thin vi.fn() wrappers
// around the real implementations, so every case runs the real code by
// default. Cases 7, 8 and 9 override one call at a time with
// mockImplementationOnce to force a failure or to prove the advisory lock.
// The advisory lock request is CR-3 (docs/contract-change-requests.md),
// still OPEN.

const OWNER_EMAIL = `lanec-owner-${randomBytes(6).toString('hex')}@crm.test`
const PREV_LINE_INBOUND_OWNER_EMAIL = process.env.LINE_INBOUND_OWNER_EMAIL
process.env.LINE_INBOUND_OWNER_EMAIL = OWNER_EMAIL

vi.mock('@/modules/crm/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/crm/service')>()
  return {
    ...actual,
    findOrCreateContactByLineUserId: vi.fn(actual.findOrCreateContactByLineUserId),
    findOrOpenLeadForContact: vi.fn(actual.findOrOpenLeadForContact),
  }
})

const { handleLineWebhook } = await import('@/modules/line/service')
const { findOrCreateContactByLineUserId, findOrOpenLeadForContact } = await import('@/modules/crm/service')
const actualCrmService = await vi.importActual<typeof import('@/modules/crm/service')>('@/modules/crm/service')

// Safety net: even though every case that queues a mockImplementationOnce
// consumes it before the test ends, this guarantees no queued override and
// no stale call history can leak from one case into the next, and that the
// mocks always fall back to the real CRM functions.
afterEach(() => {
  vi.mocked(findOrCreateContactByLineUserId).mockReset()
  vi.mocked(findOrCreateContactByLineUserId).mockImplementation(actualCrmService.findOrCreateContactByLineUserId)
  vi.mocked(findOrOpenLeadForContact).mockReset()
  vi.mocked(findOrOpenLeadForContact).mockImplementation(actualCrmService.findOrOpenLeadForContact)
})

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

  it('case 1: a valid text event creates contact, lead, message, and both activities', async () => {
    const outcome = await callWebhook([messageEvent({ lineUserId, text, messageId, webhookEventId })])
    expect(outcome).toEqual({ status: 200, processed: 1, duplicates: 0, ignored: 0, failed: 0 })

    const row = await db.webhookEvent.findUnique({ where: { webhookEventId } })
    expect(row?.status).toBe('PROCESSED')
    expect(row?.processedAt).not.toBeNull()

    const contact = await db.contact.findUnique({ where: { lineUserId } })
    expect(contact).not.toBeNull()
    expect(contact?.firstName).toBe('LINE user')
    expect(contact?.source).toBe('LINE')
    expect(contact?.lineDisplayName).toBeNull()

    const lead = await db.lead.findFirst({ where: { contactId: contact!.id } })
    expect(lead).not.toBeNull()
    expect(lead?.title).toBe('LINE: LINE user')
    expect(lead?.stage).toBe('NEW')
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

    const contactActivity = await db.activity.findFirst({
      where: { leadId: lead!.id, type: 'CONTACT_CREATED_FROM_LINE' },
    })
    expect(contactActivity).not.toBeNull()
    expect(contactActivity?.actorId).toBeNull()

    // findOrOpenLeadForContact (Lane A's real code) writes its own
    // LEAD_CREATED activity when it opens a lead: exactly one, next to
    // CONTACT_CREATED_FROM_LINE.
    const leadCreatedActivities = await db.activity.findMany({
      where: { leadId: lead!.id, type: 'LEAD_CREATED' },
    })
    expect(leadCreatedActivities).toHaveLength(1)
    expect(leadCreatedActivities[0]?.actorId).toBeNull()
  })

  it('case 2: the same body delivered again is a webhookEventId duplicate, no new rows', async () => {
    const contact = await db.contact.findUniqueOrThrow({ where: { lineUserId } })
    const lead = await db.lead.findFirstOrThrow({ where: { contactId: contact.id } })

    const before = {
      webhookEvents: await db.webhookEvent.count({ where: { webhookEventId } }),
      contacts: await db.contact.count({ where: { lineUserId } }),
      messages: await db.message.count({ where: { lineMessageId: messageId } }),
      leadCreatedActivities: await db.activity.count({ where: { leadId: lead.id, type: 'LEAD_CREATED' } }),
    }

    const outcome = await callWebhook([messageEvent({ lineUserId, text, messageId, webhookEventId })])
    expect(outcome).toEqual({ status: 200, processed: 0, duplicates: 1, ignored: 0, failed: 0 })

    expect(await db.webhookEvent.count({ where: { webhookEventId } })).toBe(before.webhookEvents)
    expect(await db.contact.count({ where: { lineUserId } })).toBe(before.contacts)
    expect(await db.message.count({ where: { lineMessageId: messageId } })).toBe(before.messages)
    expect(await db.activity.count({ where: { leadId: lead.id, type: 'LEAD_CREATED' } })).toBe(
      before.leadCreatedActivities,
    )
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
  it('rolls back the whole tx, including a real lead open, then reprocesses cleanly on redelivery', async () => {
    const lineUserId = newLineUserId()
    const webhookEventId = newWebhookEventId()
    const messageId = randomUUID()
    const secretText = 'do-not-leak-this-inbound-text'

    // The override runs the REAL findOrOpenLeadForContact first (so it
    // actually inserts a Lead and writes LEAD_CREATED inside the same tx as
    // the contact insert), then throws. That makes the assertions below a
    // real proof of rollback: if only the contact insert had happened (as a
    // throw-before-real-call override would give us), checking that the
    // lead and its activity never landed would be vacuous. With the real
    // call run first, the lead and LEAD_CREATED did exist mid-transaction,
    // and the assertions confirm the throw discarded them along with the
    // contact when the whole tx aborted.
    const real = actualCrmService.findOrOpenLeadForContact
    let openedLeadId: string | undefined
    vi.mocked(findOrOpenLeadForContact).mockImplementationOnce(async (tx, input) => {
      const result = await real(tx, input)
      openedLeadId = result.lead.id
      throw new DomainError('INTERNAL', 'forced-failure-case7-after-real-lead-open')
    })

    const outcome = await callWebhook([messageEvent({ lineUserId, text: secretText, messageId, webhookEventId })])
    expect(outcome).toEqual({ status: 500, processed: 0, duplicates: 0, ignored: 0, failed: 1 })

    const row = await db.webhookEvent.findUnique({ where: { webhookEventId } })
    expect(row?.status).toBe('FAILED')
    expect(row?.error).not.toBeNull()
    expect(row?.error).not.toContain(secretText)

    // openedLeadId proves the real lead insert (and its LEAD_CREATED write)
    // happened mid-transaction; none of it, nor the contact, survives the
    // rollback.
    expect(openedLeadId).toBeDefined()
    expect(await db.contact.count({ where: { lineUserId } })).toBe(0)
    expect(await db.lead.findUnique({ where: { id: openedLeadId! } })).toBeNull()
    expect(await db.activity.count({ where: { leadId: openedLeadId! } })).toBe(0)

    const redelivered = await callWebhook([messageEvent({ lineUserId, text: secretText, messageId, webhookEventId })])
    expect(redelivered).toEqual({ status: 200, processed: 1, duplicates: 0, ignored: 0, failed: 0 })

    const contact = await db.contact.findUniqueOrThrow({ where: { lineUserId } })
    expect(await db.contact.count({ where: { lineUserId } })).toBe(1)
    const lead = await db.lead.findFirstOrThrow({ where: { contactId: contact.id } })
    expect(await db.lead.count({ where: { contactId: contact.id } })).toBe(1)
    expect(await db.message.count({ where: { lineMessageId: messageId } })).toBe(1)
    expect(await db.activity.count({ where: { leadId: lead.id, type: 'LEAD_CREATED' } })).toBe(1)
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
  it('blocks the second delivery until the first releases the barrier, then settles to one contact and one lead', async () => {
    // See assertions below for the exact expected counts: 1 contact, 1 lead,
    // 2 messages, and 1 LEAD_CREATED activity once both deliveries finish.
    const lineUserId = newLineUserId()
    const eventA = messageEvent({ lineUserId, text: 'concurrent A' })
    const eventB = messageEvent({ lineUserId, text: 'concurrent B' })

    // The real implementation, captured once, so the barrier can delegate to
    // it after release instead of returning a canned result.
    const real = actualCrmService.findOrCreateContactByLineUserId
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
    // released and the first transaction commits (releasing the lock). If
    // lockLineUser were removed from modules/line/webhook.ts, the second
    // delivery would reach this mock immediately, and the call count check
    // below (still 1, not 2) would fail.
    vi.mocked(findOrCreateContactByLineUserId).mockImplementationOnce(async (tx, input) => {
      firstEnteredResolve()
      await barrier
      return real(tx, input)
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
    const lead = await db.lead.findFirstOrThrow({ where: { contactId: contact.id } })
    expect(await db.lead.count({ where: { contactId: contact.id } })).toBe(1)
    expect(await db.message.count({ where: { contactId: contact.id } })).toBe(2)
    expect(await db.activity.count({ where: { leadId: lead.id, type: 'LEAD_CREATED' } })).toBe(1)
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

async function createPlaceholderContact(lineUserId: string, firstName = 'LINE user') {
  return db.contact.create({
    data: { firstName, lineUserId, source: 'LINE' },
  })
}

async function createLeadFor(
  contactId: string,
  overrides: { title?: string; stage?: 'NEW' | 'QUALIFIED' | 'PROPOSAL' | 'WON' | 'LOST' } = {},
) {
  const stage = overrides.stage ?? 'NEW'
  return db.lead.create({
    data: {
      title: overrides.title ?? 'LINE: LINE user',
      contactId,
      ownerId: adminId,
      source: 'LINE',
      stage,
      lostReason: stage === 'LOST' ? 'test fixture' : undefined,
    },
  })
}

function throwingProfileLine(): LineClient {
  return {
    mode: 'mock',
    verifySignature: () => true,
    push: async () => ({ ok: true, httpStatus: 200, duplicate: false, requestId: null }),
    getProfile: async () => {
      throw new Error('getProfile failed')
    },
  }
}

function nullProfileLine(): LineClient {
  return {
    mode: 'mock',
    verifySignature: () => true,
    push: async () => ({ ok: true, httpStatus: 200, duplicate: false, requestId: null }),
    getProfile: async () => null,
  }
}

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

  it('(a) fills firstName, lineDisplayName, and an open placeholder-titled lead title', async () => {
    const lineUserId = newLineUserId()
    const contact = await createPlaceholderContact(lineUserId)
    const lead = await createLeadFor(contact.id)
    const name = 'สมชาย ใจดี'
    line.setProfileName(lineUserId, name)

    await backfillContactProfile(db, line, { contactId: contact.id, lineUserId })

    const updatedContact = await db.contact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(updatedContact.firstName).toBe(name)
    expect(updatedContact.lineDisplayName).toBe(name)

    const updatedLead = await db.lead.findUniqueOrThrow({ where: { id: lead.id } })
    expect(updatedLead.title).toBe('LINE: ' + name)
  })

  it('(b) keeps an already-edited firstName but still fills a null lineDisplayName', async () => {
    const lineUserId = newLineUserId()
    const contact = await createPlaceholderContact(lineUserId, 'Somchai (edited)')
    const name = 'New Display Name'
    line.setProfileName(lineUserId, name)

    await backfillContactProfile(db, line, { contactId: contact.id, lineUserId })

    const updated = await db.contact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(updated.firstName).toBe('Somchai (edited)')
    expect(updated.lineDisplayName).toBe(name)
  })

  it('(c) keeps an already-edited lead title', async () => {
    const lineUserId = newLineUserId()
    const contact = await createPlaceholderContact(lineUserId)
    const lead = await createLeadFor(contact.id, { title: 'Custom title chosen by sales' })
    line.setProfileName(lineUserId, 'Another Name')

    await backfillContactProfile(db, line, { contactId: contact.id, lineUserId })

    const updated = await db.lead.findUniqueOrThrow({ where: { id: lead.id } })
    expect(updated.title).toBe('Custom title chosen by sales')
  })

  it('(d) leaves WON and LOST placeholder-titled leads unchanged', async () => {
    const lineUserId = newLineUserId()
    const contact = await createPlaceholderContact(lineUserId)
    const wonLead = await createLeadFor(contact.id, { stage: 'WON' })
    const lostLead = await createLeadFor(contact.id, { stage: 'LOST' })
    line.setProfileName(lineUserId, 'Somchai Won Lost')

    await backfillContactProfile(db, line, { contactId: contact.id, lineUserId })

    expect((await db.lead.findUniqueOrThrow({ where: { id: wonLead.id } })).title).toBe('LINE: LINE user')
    expect((await db.lead.findUniqueOrThrow({ where: { id: lostLead.id } })).title).toBe('LINE: LINE user')
  })

  it('(e) is idempotent: a second run with a different profile name changes nothing further', async () => {
    const lineUserId = newLineUserId()
    const contact = await createPlaceholderContact(lineUserId)
    const lead = await createLeadFor(contact.id)
    const firstName = 'First Name Wins'
    line.setProfileName(lineUserId, firstName)

    await backfillContactProfile(db, line, { contactId: contact.id, lineUserId })
    line.setProfileName(lineUserId, 'Second Name Should Not Apply')
    await backfillContactProfile(db, line, { contactId: contact.id, lineUserId })

    const updatedContact = await db.contact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(updatedContact.firstName).toBe(firstName)
    expect(updatedContact.lineDisplayName).toBe(firstName)

    const updatedLead = await db.lead.findUniqueOrThrow({ where: { id: lead.id } })
    expect(updatedLead.title).toBe('LINE: ' + firstName)
  })

  it('(f) a whitespace/control-only display name makes no change', async () => {
    const lineUserId = newLineUserId()
    const contact = await createPlaceholderContact(lineUserId)
    const lead = await createLeadFor(contact.id)
    line.setProfileName(lineUserId, '   \x00\x1F\x7F   ')

    await backfillContactProfile(db, line, { contactId: contact.id, lineUserId })

    const updatedContact = await db.contact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(updatedContact.firstName).toBe('LINE user')
    expect(updatedContact.lineDisplayName).toBeNull()

    const updatedLead = await db.lead.findUniqueOrThrow({ where: { id: lead.id } })
    expect(updatedLead.title).toBe('LINE: LINE user')
  })

  it('(g) caps a 150-char display name to 100 chars in firstName/lineDisplayName and the lead title', async () => {
    const lineUserId = newLineUserId()
    const contact = await createPlaceholderContact(lineUserId)
    const lead = await createLeadFor(contact.id)
    const longName = 'A'.repeat(150)
    line.setProfileName(lineUserId, longName)

    await backfillContactProfile(db, line, { contactId: contact.id, lineUserId })

    const expected = 'A'.repeat(100)
    const updatedContact = await db.contact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(updatedContact.firstName).toBe(expected)
    expect(updatedContact.lineDisplayName).toBe(expected)

    const updatedLead = await db.lead.findUniqueOrThrow({ where: { id: lead.id } })
    expect(updatedLead.title).toBe('LINE: ' + expected)
  })

  it('(h) a throwing getProfile makes no change and does not throw', async () => {
    const lineUserId = newLineUserId()
    const contact = await createPlaceholderContact(lineUserId)
    const lead = await createLeadFor(contact.id)

    await expect(
      backfillContactProfile(db, throwingProfileLine(), { contactId: contact.id, lineUserId }),
    ).resolves.toBeUndefined()

    const updated = await db.contact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(updated.firstName).toBe('LINE user')
    expect(updated.lineDisplayName).toBeNull()

    const updatedLead = await db.lead.findUniqueOrThrow({ where: { id: lead.id } })
    expect(updatedLead.title).toBe('LINE: LINE user')
  })

  it('(h) a null getProfile makes no change and does not throw', async () => {
    const lineUserId = newLineUserId()
    const contact = await createPlaceholderContact(lineUserId)
    const lead = await createLeadFor(contact.id)

    await expect(
      backfillContactProfile(db, nullProfileLine(), { contactId: contact.id, lineUserId }),
    ).resolves.toBeUndefined()

    const updated = await db.contact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(updated.firstName).toBe('LINE user')
    expect(updated.lineDisplayName).toBeNull()

    const updatedLead = await db.lead.findUniqueOrThrow({ where: { id: lead.id } })
    expect(updatedLead.title).toBe('LINE: LINE user')
  })

  it('(i) logs line.profile_backfilled with counts, never the display name', async () => {
    const prevLogLevel = process.env.LOG_LEVEL
    process.env.LOG_LEVEL = 'debug'
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const lineUserId = newLineUserId()
      const contact = await createPlaceholderContact(lineUserId)
      await createLeadFor(contact.id)
      const secretName = 'ห้าม log ชื่อนี้'
      line.setProfileName(lineUserId, secretName)

      await backfillContactProfile(db, line, { contactId: contact.id, lineUserId })

      const logged = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(logged).toContain('line.profile_backfilled')
      expect(logged).not.toContain(secretName)
      expect(logged).toContain('"displayNameSet":1')
      expect(logged).toContain('"firstNameSet":1')
      expect(logged).toContain('"leadTitlesSet":1')
    } finally {
      logSpy.mockRestore()
      if (prevLogLevel === undefined) delete process.env.LOG_LEVEL
      else process.env.LOG_LEVEL = prevLogLevel
    }
  })

  it('(j) a control character mid-name is replaced with a space, not deleted', async () => {
    const lineUserId = newLineUserId()
    const contact = await createPlaceholderContact(lineUserId)
    // String.fromCharCode, not a raw control byte in this source file.
    const name = 'Som' + String.fromCharCode(0x00) + 'chai'
    line.setProfileName(lineUserId, name)

    await backfillContactProfile(db, line, { contactId: contact.id, lineUserId })

    const updated = await db.contact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(updated.firstName).toBe('Som chai')
    expect(updated.lineDisplayName).toBe('Som chai')
  })

  it('(k) a bidi override and zero-width characters are stripped, not left in the name', async () => {
    const lineUserId = newLineUserId()
    const contact = await createPlaceholderContact(lineUserId)
    // Built from numeric code points via String.fromCharCode, not literal
    // invisible/bidi characters in this source file.
    const zeroWidthSpace = String.fromCharCode(0x200b)
    const rightToLeftOverride = String.fromCharCode(0x202e)
    const byteOrderMark = String.fromCharCode(0xfeff)
    const name = zeroWidthSpace + 'Som' + rightToLeftOverride + 'chai' + byteOrderMark
    line.setProfileName(lineUserId, name)

    await backfillContactProfile(db, line, { contactId: contact.id, lineUserId })

    const updated = await db.contact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(updated.firstName).toBe('Som chai')
    expect(updated.lineDisplayName).toBe('Som chai')
  })

  it('(l) a 100-char cap that would split a surrogate pair drops the lone high surrogate', async () => {
    const lineUserId = newLineUserId()
    const contact = await createPlaceholderContact(lineUserId)
    // U+1F600 (grinning face) as its UTF-16 surrogate pair, built via
    // String.fromCharCode so no raw astral character sits in this file.
    const emoji = String.fromCharCode(0xd83d, 0xde00)
    const name = 'A'.repeat(99) + emoji
    line.setProfileName(lineUserId, name)

    await backfillContactProfile(db, line, { contactId: contact.id, lineUserId })

    const expected = 'A'.repeat(99)
    const updated = await db.contact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(updated.firstName).toBe(expected)
    expect(updated.lineDisplayName).toBe(expected)
    expect(updated.firstName.charCodeAt(updated.firstName.length - 1)).toBeLessThan(0xd800)
  })

  it('(m) legacy shape: lineDisplayName already set but firstName still placeholder only updates firstName', async () => {
    const lineUserId = newLineUserId()
    const contact = await db.contact.create({
      data: { firstName: 'LINE user', lineUserId, source: 'LINE', lineDisplayName: 'Already Set From Before' },
    })
    const name = 'New Profile Name'
    line.setProfileName(lineUserId, name)

    await backfillContactProfile(db, line, { contactId: contact.id, lineUserId })

    const updated = await db.contact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(updated.firstName).toBe(name)
    expect(updated.lineDisplayName).toBe('Already Set From Before')
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

  it('returns 400 for a displayName over 100 chars', async () => {
    const { POST } = await import('@/app/api/dev/line/simulate/route')
    const token = await cookieFor(adminId, 'ADMIN', 'Lane C Test Admin')
    const req = simulateRequest(
      { event: 'message', text: 'simulated from admin', displayName: 'x'.repeat(101) },
      token,
    )
    const res = await POST(req, {})
    expect(res.status).toBe(400)
  })

  it('returns 400 for a displayName with control characters', async () => {
    const { POST } = await import('@/app/api/dev/line/simulate/route')
    const token = await cookieFor(adminId, 'ADMIN', 'Lane C Test Admin')
    const req = simulateRequest(
      { event: 'message', text: 'simulated from admin', displayName: 'bad\x00name' },
      token,
    )
    const res = await POST(req, {})
    expect(res.status).toBe(400)
  })

  it('a valid displayName reaches MockLineClient.getProfile', async () => {
    // The route reads its LineClient via getLineClient()'s process-wide
    // singleton, not the test's own `line` instance, so the profile has to
    // be read back through the same singleton.
    const { getLineClient } = await import('@/modules/line/client')
    const { POST } = await import('@/app/api/dev/line/simulate/route')
    const token = await cookieFor(adminId, 'ADMIN', 'Lane C Test Admin')
    const req = simulateRequest(
      { event: 'message', text: 'simulated from admin', displayName: 'Somchai Simulated' },
      token,
    )
    const res = await POST(req, {})
    expect(res.status).toBe(200)
    const json = (await res.json()) as { outcome: { processed: number }; lineUserId: string; webhookEventId: string }
    trackedLineUserIds.add(json.lineUserId)
    trackedWebhookEventIds.add(json.webhookEventId)

    const routeLine = getLineClient() as MockLineClient
    const profile = await routeLine.getProfile(json.lineUserId)
    expect(profile).toEqual({ userId: json.lineUserId, displayName: 'Somchai Simulated' })
  })
})
