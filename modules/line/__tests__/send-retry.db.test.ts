import { randomBytes } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import type { Actor } from '@/lib/auth/dal'
import { encrypt, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { MockLineClient } from '@/modules/line/client.mock'
import type { PushResult } from '@/modules/line/types'

// [C-tester] modules/line/__tests__/send-retry.db.test.ts: real Postgres
// (crm_test). Mocks modules/line/delay so retry backoff sleeps are instant,
// per plan-S4.md step 21.

vi.mock('@/modules/line/delay', () => ({ sleep: vi.fn(async () => {}) }))

const { sleep } = await import('@/modules/line/delay')
const { sendLineMessage, retryMessage, deliverQueuedMessage, enqueueLineMessage } = await import(
  '@/modules/line/service'
)

const db = getDb()
const SECRET = 'send-retry-db-test-secret'
const APP_ORIGIN = 'http://localhost:3000'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function freshLine(): MockLineClient {
  return new MockLineClient(SECRET)
}

const trackedContactIds: string[] = []
const trackedLeadIds: string[] = []
const trackedUserIds: string[] = []

function newLineUserId(): string {
  return 'U' + randomBytes(16).toString('hex')
}

async function createLeadWithContact(overrides: { lineUserId?: string | null; ownerId?: string } = {}) {
  const lineUserId = overrides.lineUserId === undefined ? newLineUserId() : overrides.lineUserId
  const contact = await db.contact.create({
    data: { firstName: 'Test', lineUserId, source: 'LINE' },
  })
  const lead = await db.lead.create({
    data: {
      title: 'Send/retry test lead',
      contactId: contact.id,
      ownerId: overrides.ownerId ?? ownerUser.id,
      source: 'LINE',
    },
  })
  trackedContactIds.push(contact.id)
  trackedLeadIds.push(lead.id)
  return { contact, lead }
}

let ownerUser: { id: string; name: string }
let otherSalesUser: { id: string; name: string }
let adminUser: { id: string; name: string }
let actor: Actor
let otherActor: Actor
let adminActor: Actor

beforeAll(async () => {
  const owner = await db.user.create({
    data: {
      email: `lanec-owner-sr-${randomBytes(6).toString('hex')}@crm.test`,
      name: 'Lane C SR Owner',
      role: 'SALES',
      passwordHash: 'not-a-real-hash',
    },
  })
  ownerUser = { id: owner.id, name: owner.name }
  trackedUserIds.push(owner.id)

  const other = await db.user.create({
    data: {
      email: `lanec-other-sr-${randomBytes(6).toString('hex')}@crm.test`,
      name: 'Lane C SR Other Sales',
      role: 'SALES',
      passwordHash: 'not-a-real-hash',
    },
  })
  otherSalesUser = { id: other.id, name: other.name }
  trackedUserIds.push(other.id)

  const admin = await db.user.create({
    data: {
      email: `lanec-admin-sr-${randomBytes(6).toString('hex')}@crm.test`,
      name: 'Lane C SR Admin',
      role: 'ADMIN',
      passwordHash: 'not-a-real-hash',
    },
  })
  adminUser = { id: admin.id, name: admin.name }
  trackedUserIds.push(admin.id)

  actor = { kind: 'user', id: ownerUser.id, role: 'SALES', name: ownerUser.name }
  otherActor = { kind: 'user', id: otherSalesUser.id, role: 'SALES', name: otherSalesUser.name }
  adminActor = { kind: 'user', id: adminUser.id, role: 'ADMIN', name: adminUser.name }
})

afterEach(() => {
  vi.mocked(sleep).mockClear()
})

afterAll(async () => {
  await db.activity.deleteMany({ where: { leadId: { in: trackedLeadIds } } })
  await db.message.deleteMany({ where: { contactId: { in: trackedContactIds } } })
  await db.lead.deleteMany({ where: { id: { in: trackedLeadIds } } })
  await db.contact.deleteMany({ where: { id: { in: trackedContactIds } } })
  await db.user.deleteMany({ where: { id: { in: trackedUserIds } } })
})

describe('case 1: happy send', () => {
  it('goes SENT with a uuid retryKey, attemptCount 1, lineRequestId, and a MESSAGE_SENT activity', async () => {
    const line = freshLine()
    const { lead } = await createLeadWithContact()

    const msg = await sendLineMessage({ leadId: lead.id, text: 'hello there', actor }, { line, db })

    expect(msg.status).toBe('SENT')
    expect(msg.retryKey).toMatch(UUID_RE)
    expect(msg.attemptCount).toBe(1)
    expect(msg.lineRequestId).toBe('mock-1')
    expect(msg.sentAt).not.toBeNull()
    expect(msg.sentById).toBe(ownerUser.id)

    expect(line.sent).toHaveLength(1)
    expect(line.sent[0]?.retryKey).toBe(msg.retryKey)

    const activity = await db.activity.findFirst({ where: { leadId: lead.id, type: 'MESSAGE_SENT' } })
    expect(activity).not.toBeNull()
    expect(activity?.meta).toMatchObject({ messageId: msg.id, retryKey: msg.retryKey, attempts: 1 })
  })
})

describe('case 2: the retryKey is stored as QUEUED before the network call', () => {
  it('lets a push wrapper read a QUEUED row with that retryKey from the DB', async () => {
    const line = freshLine()
    const { lead } = await createLeadWithContact()
    let sawQueued = false

    const original = line.push.bind(line)
    vi.spyOn(line, 'push').mockImplementation(async (to, messages, retryKey) => {
      const row = await db.message.findUnique({ where: { retryKey } })
      sawQueued = row?.status === 'QUEUED'
      return original(to, messages, retryKey)
    })

    const msg = await sendLineMessage({ leadId: lead.id, text: 'check queued first', actor }, { line, db })
    expect(sawQueued).toBe(true)
    expect(msg.status).toBe('SENT')
  })
})

describe('case 3: failNext(2) retries with backoff then succeeds', () => {
  it('gives SENT, attemptCount 3, the same key on every attempt, and sleeps 300 then 1200', async () => {
    const line = freshLine()
    const { lead } = await createLeadWithContact()
    line.failNext(2)

    const msg = await sendLineMessage({ leadId: lead.id, text: 'retries then ok', actor }, { line, db })

    expect(msg.status).toBe('SENT')
    expect(msg.attemptCount).toBe(3)
    expect(line.sent).toHaveLength(1)
    expect(line.sent[0]?.retryKey).toBe(msg.retryKey)
    expect(vi.mocked(sleep).mock.calls.map((c) => c[0])).toEqual([300, 1200])
  })
})

describe('case 4: failNext(3) exhausts all attempts', () => {
  it('gives FAILED with a SERVER 500 lastError, a MESSAGE_FAILED activity, and no throw', async () => {
    const line = freshLine()
    const { lead } = await createLeadWithContact()
    line.failNext(3)

    const msg = await sendLineMessage({ leadId: lead.id, text: 'always fails', actor }, { line, db })

    expect(msg.status).toBe('FAILED')
    expect(msg.attemptCount).toBe(3)
    expect(msg.lastError).toMatch(/^SERVER 500/)

    const activity = await db.activity.findFirst({ where: { leadId: lead.id, type: 'MESSAGE_FAILED' } })
    expect(activity).not.toBeNull()
  })
})

describe('case 5: CONFIG failure is not retried', () => {
  it('gives FAILED after 1 attempt, no sleep, and an error-level line.push.failed log', async () => {
    const line = freshLine()
    const { lead } = await createLeadWithContact()
    line.failNext(1, { errorCode: 'CONFIG' })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const msg = await sendLineMessage({ leadId: lead.id, text: 'config broken', actor }, { line, db })

    expect(msg.status).toBe('FAILED')
    expect(msg.attemptCount).toBe(1)
    expect(vi.mocked(sleep)).not.toHaveBeenCalled()
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('line.push.failed'))).toBe(true)
    errorSpy.mockRestore()
  })
})

describe('case 6: RATE_LIMITED failure is not retried', () => {
  it('gives FAILED after 1 attempt', async () => {
    const line = freshLine()
    const { lead } = await createLeadWithContact()
    line.failNext(1, { errorCode: 'RATE_LIMITED' })

    const msg = await sendLineMessage({ leadId: lead.id, text: 'rate limited', actor }, { line, db })

    expect(msg.status).toBe('FAILED')
    expect(msg.attemptCount).toBe(1)
  })
})

describe('case 7: retryMessage on FAILED', () => {
  it('gives SENT with the same retryKey, and attemptCount keeps growing', async () => {
    const line = freshLine()
    const { lead } = await createLeadWithContact()
    line.failNext(3)
    const failed = await sendLineMessage({ leadId: lead.id, text: 'will be retried', actor }, { line, db })
    expect(failed.status).toBe('FAILED')

    const retried = await retryMessage({ messageId: failed.id, actor }, { line, db })

    expect(retried.status).toBe('SENT')
    expect(retried.retryKey).toBe(failed.retryKey)
    expect(retried.attemptCount).toBeGreaterThan(failed.attemptCount)
  })
})

describe('case 8: a lost response is deduped as the original send on retry', () => {
  it('reuses the accepted requestId with no new sent entry', async () => {
    const line = freshLine()
    const { contact, lead } = await createLeadWithContact()

    const queued = await db.$transaction((tx) => enqueueLineMessage(tx, { leadId: lead.id, text: 'lost response', actor }))
    expect(queued.retryKey).not.toBeNull()

    const direct: PushResult = await line.push(
      contact.lineUserId!,
      [{ type: 'text', text: 'lost response' }],
      queued.retryKey!,
    )
    expect(direct.ok).toBe(true)
    const originalRequestId = direct.ok ? direct.requestId : null
    expect(line.sent).toHaveLength(1)

    await db.message.update({
      where: { id: queued.id },
      data: { status: 'FAILED', lastError: 'NETWORK -: simulated lost response' },
    })

    const retried = await retryMessage({ messageId: queued.id, actor }, { line, db })

    expect(retried.status).toBe('SENT')
    expect(retried.lineRequestId).toBe(originalRequestId)
    expect(line.sent).toHaveLength(1)
  })
})

describe('case 9: retry state guards', () => {
  it('CONFLICTs on a SENT message', async () => {
    const line = freshLine()
    const { lead } = await createLeadWithContact()
    const sent = await sendLineMessage({ leadId: lead.id, text: 'already sent', actor }, { line, db })
    expect(sent.status).toBe('SENT')

    await expect(retryMessage({ messageId: sent.id, actor }, { line, db })).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('CONFLICTs on a QUEUED message updated under 60s ago, then succeeds once backdated', async () => {
    const line = freshLine()
    const { lead } = await createLeadWithContact()
    const queued = await db.$transaction((tx) => enqueueLineMessage(tx, { leadId: lead.id, text: 'freshly queued', actor }))

    await expect(retryMessage({ messageId: queued.id, actor }, { line, db })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'message is still being delivered',
    })

    await db.$executeRaw`UPDATE "Message" SET "updatedAt" = NOW() - INTERVAL '2 minutes' WHERE id = ${queued.id}`

    const retried = await retryMessage({ messageId: queued.id, actor }, { line, db })
    expect(retried.status).toBe('SENT')
  })
})

describe('case 10: a 23h+ old message cannot be delivered or retried', () => {
  it('deliverQueuedMessage CONFLICTs on a QUEUED message older than 23h, and never calls push', async () => {
    const line = freshLine()
    const { lead } = await createLeadWithContact()
    const queued = await db.$transaction((tx) => enqueueLineMessage(tx, { leadId: lead.id, text: 'ancient', actor }))
    await db.$executeRaw`UPDATE "Message" SET "createdAt" = NOW() - INTERVAL '24 hours' WHERE id = ${queued.id}`

    const pushSpy = vi.spyOn(line, 'push')

    await expect(deliverQueuedMessage(queued.id, { line, db })).rejects.toMatchObject({ code: 'CONFLICT' })

    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('retryMessage CONFLICTs on a FAILED message backdated 23h5m, citing the 23h guard specifically, and never calls push', async () => {
    // Backdated createdAt by more than 23h *and* status FAILED (not QUEUED),
    // so this can only pass via the top-level 23h-expiry guard in
    // retryMessage: a FAILED row never reaches the QUEUED 60s-guard branch.
    //
    // retryMessage's own guard (service.ts ~530-535) throws "This message is
    // older than 23 hours, so its LINE retry key may have expired. Send it
    // as a new message instead." *before* touching the row at all. If that
    // guard were removed, the FAILED row would get claimed (status flipped
    // to QUEUED) and handed to deliverQueuedMessage, whose own 23h guard
    // (service.ts ~360) throws a *different* message ("retry key expired
    // (older than 23 hours): send a new message") only after the revert
    // path has already reset status back to FAILED, lastError, updatedAt,
    // and attemptCount. So asserting the exact retryMessage wording, plus
    // that the row was never touched, is what actually pins down which
    // guard fired: a generic 'older than 23 hours' substring matches both
    // messages and would not have caught the guard moving.
    const line = freshLine()
    const { lead } = await createLeadWithContact()
    line.failNext(3)
    const failed = await sendLineMessage({ leadId: lead.id, text: 'ancient failed', actor }, { line, db })
    expect(failed.status).toBe('FAILED')
    await db.$executeRaw`UPDATE "Message" SET "createdAt" = NOW() - INTERVAL '23 hours 5 minutes' WHERE id = ${failed.id}`

    const before = await db.message.findUniqueOrThrow({ where: { id: failed.id } })
    expect(before.status).toBe('FAILED')

    const pushSpy = vi.spyOn(line, 'push')

    await expect(retryMessage({ messageId: failed.id, actor }, { line, db })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('may have expired'),
    })

    expect(pushSpy).not.toHaveBeenCalled()

    const after = await db.message.findUniqueOrThrow({ where: { id: failed.id } })
    expect(after.status).toBe('FAILED')
    expect(after.lastError).toBe(before.lastError)
    expect(after.updatedAt).toEqual(before.updatedAt)
    expect(after.attemptCount).toBe(before.attemptCount)
  })

  it('retryMessage succeeds on a FAILED message backdated 22h55m, keeping the same retryKey', async () => {
    const line = freshLine()
    const { lead } = await createLeadWithContact()
    line.failNext(3)
    const failed = await sendLineMessage({ leadId: lead.id, text: 'not yet expired', actor }, { line, db })
    expect(failed.status).toBe('FAILED')
    await db.$executeRaw`UPDATE "Message" SET "createdAt" = NOW() - INTERVAL '22 hours 55 minutes' WHERE id = ${failed.id}`

    const retried = await retryMessage({ messageId: failed.id, actor }, { line, db })

    expect(retried.status).toBe('SENT')
    expect(retried.retryKey).toBe(failed.retryKey)
  })
})

describe('case 11: FORBIDDEN for another SALES user, allowed for ADMIN', () => {
  it('blocks a different SALES user on send and retry, but allows ADMIN to retry', async () => {
    const line = freshLine()
    const { lead } = await createLeadWithContact()

    await expect(sendLineMessage({ leadId: lead.id, text: 'not yours', actor: otherActor }, { line, db })).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    )

    line.failNext(3)
    const failed = await sendLineMessage({ leadId: lead.id, text: 'owner sends', actor }, { line, db })
    expect(failed.status).toBe('FAILED')

    await expect(retryMessage({ messageId: failed.id, actor: otherActor }, { line, db })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    const retriedByAdmin = await retryMessage({ messageId: failed.id, actor: adminActor }, { line, db })
    expect(retriedByAdmin.status).toBe('SENT')

    // The retrying actor (the admin), not the message's original sender (the
    // owner), is recorded on the MESSAGE_SENT activity.
    const activity = await db.activity.findFirst({
      where: { leadId: lead.id, type: 'MESSAGE_SENT' },
      orderBy: { createdAt: 'desc' },
    })
    expect(activity).not.toBeNull()
    expect(activity?.actorId).toBe(adminUser.id)
  })
})

describe('case 17: deliver() throwing after the claim reverts the row to FAILED, not left QUEUED', () => {
  it('reverts a retried FAILED message back to FAILED when push throws mid-delivery', async () => {
    const line = freshLine()
    const { lead } = await createLeadWithContact()
    line.failNext(3)
    const failed = await sendLineMessage({ leadId: lead.id, text: 'will throw on retry', actor }, { line, db })
    expect(failed.status).toBe('FAILED')

    vi.spyOn(line, 'push').mockRejectedValueOnce(new Error('boom mid-delivery'))

    await expect(retryMessage({ messageId: failed.id, actor }, { line, db })).rejects.toThrow('boom mid-delivery')

    const row = await db.message.findUniqueOrThrow({ where: { id: failed.id } })
    expect(row.status).toBe('FAILED')
    expect(row.lastError).not.toBeNull()
  })
})

describe('case 12: a contact with no LINE user id', () => {
  it('gives UNPROCESSABLE with no Message row created', async () => {
    const line = freshLine()
    const { contact, lead } = await createLeadWithContact({ lineUserId: null })

    await expect(sendLineMessage({ leadId: lead.id, text: 'nowhere to send', actor }, { line, db })).rejects.toMatchObject({
      code: 'UNPROCESSABLE',
    })
    expect(await db.message.count({ where: { contactId: contact.id } })).toBe(0)
  })
})

describe('case 13: NOT_FOUND', () => {
  it('for an unknown lead on send, and an unknown message on retry', async () => {
    const line = freshLine()
    await expect(sendLineMessage({ leadId: 'unknown-lead-id', text: 'x', actor }, { line, db })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(retryMessage({ messageId: 'unknown-message-id', actor }, { line, db })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('case 14: no message text ever reaches the logs', () => {
  it('keeps the body out of console.log and console.error', async () => {
    const line = freshLine()
    const { lead } = await createLeadWithContact()
    const secretText = 'super-secret-outbound-message-body'
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await sendLineMessage({ leadId: lead.id, text: secretText, actor }, { line, db })

    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((c) => String(c[0])).join('\n')
    expect(logged).not.toContain(secretText)

    logSpy.mockRestore()
    errorSpy.mockRestore()
  })
})

describe('case 15: the messages route', () => {
  function req(leadId: string, body: unknown, opts: { cookie?: string | null; origin?: string | null } = {}): NextRequest {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (opts.origin !== null) headers.origin = opts.origin ?? APP_ORIGIN
    if (opts.cookie !== null && opts.cookie !== undefined) headers.cookie = `${SESSION_COOKIE_NAME}=${opts.cookie}`
    return new NextRequest(`http://localhost:3000/api/leads/${leadId}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  }

  it('LINE gives 200 with a message-kind item, status SENT, and no internal delivery fields', async () => {
    const { POST } = await import('@/app/api/leads/[id]/messages/route')
    const { lead } = await createLeadWithContact()
    const token = await encrypt({ sub: ownerUser.id, role: 'SALES', name: ownerUser.name })
    const ctx = { params: Promise.resolve({ id: lead.id }) }

    const res = await POST(req(lead.id, { channel: 'LINE', text: 'via route' }, { cookie: token }), ctx)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { message: Record<string, unknown> }
    expect(json.message.kind).toBe('message')
    expect(json.message.status).toBe('SENT')
    expect(json.message).not.toHaveProperty('retryKey')
    expect(json.message).not.toHaveProperty('payload')
    expect(json.message).not.toHaveProperty('lineRequestId')
    expect(json.message).not.toHaveProperty('sentById')
  })

  it('MANUAL gives LOGGED with no push', async () => {
    const { POST } = await import('@/app/api/leads/[id]/messages/route')
    const { lead } = await createLeadWithContact()
    const token = await encrypt({ sub: ownerUser.id, role: 'SALES', name: ownerUser.name })
    const ctx = { params: Promise.resolve({ id: lead.id }) }

    const res = await POST(
      req(lead.id, { channel: 'MANUAL', direction: 'OUTBOUND', text: 'manual note' }, { cookie: token }),
      ctx,
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { message: Record<string, unknown> }
    expect(json.message.status).toBe('LOGGED')
  })

  it('LINE plus INBOUND gives 400', async () => {
    const { POST } = await import('@/app/api/leads/[id]/messages/route')
    const { lead } = await createLeadWithContact()
    const token = await encrypt({ sub: ownerUser.id, role: 'SALES', name: ownerUser.name })
    const ctx = { params: Promise.resolve({ id: lead.id }) }

    const res = await POST(req(lead.id, { channel: 'LINE', direction: 'INBOUND', text: 'bad' }, { cookie: token }), ctx)
    expect(res.status).toBe(400)
  })

  it('no cookie gives 401', async () => {
    const { POST } = await import('@/app/api/leads/[id]/messages/route')
    const { lead } = await createLeadWithContact()
    const ctx = { params: Promise.resolve({ id: lead.id }) }

    const res = await POST(req(lead.id, { channel: 'MANUAL', direction: 'OUTBOUND', text: 'x' }, { cookie: null }), ctx)
    expect(res.status).toBe(401)
  })

  it('the wrong origin gives 403', async () => {
    const { POST } = await import('@/app/api/leads/[id]/messages/route')
    const { lead } = await createLeadWithContact()
    const token = await encrypt({ sub: ownerUser.id, role: 'SALES', name: ownerUser.name })
    const ctx = { params: Promise.resolve({ id: lead.id }) }

    const res = await POST(
      req(lead.id, { channel: 'MANUAL', direction: 'OUTBOUND', text: 'x' }, { cookie: token, origin: 'http://evil.example' }),
      ctx,
    )
    expect(res.status).toBe(403)
  })
})

describe('case 16: the retry route', () => {
  it('moves a FAILED message to SENT with 200', async () => {
    const line = freshLine()
    const { lead } = await createLeadWithContact()
    line.failNext(3)
    const failed = await sendLineMessage({ leadId: lead.id, text: 'retry via route', actor }, { line, db })
    expect(failed.status).toBe('FAILED')

    const { POST } = await import('@/app/api/messages/[id]/retry/route')
    const token = await encrypt({ sub: ownerUser.id, role: 'SALES', name: ownerUser.name })
    const request = new NextRequest(`http://localhost:3000/api/messages/${failed.id}/retry`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: APP_ORIGIN,
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
      body: '{}',
    })
    const ctx = { params: Promise.resolve({ id: failed.id }) }

    const res = await POST(request, ctx)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { message: Record<string, unknown> }
    expect(json.message.status).toBe('SENT')
  })
})
