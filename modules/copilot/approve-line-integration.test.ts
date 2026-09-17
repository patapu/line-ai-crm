import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/lib/db'
import type { Actor } from '@/lib/auth/dal'
import { approveSuggestion } from '@/modules/copilot/service'
import { MockLineClient } from '@/modules/line/client.mock'

// [B-tester] modules/copilot/approve-line-integration.test.ts: cross-lane
// check (S2). Unlike modules/copilot/service.test.ts, this file does NOT mock
// '@/modules/line/service': it runs the REAL enqueueLineMessage /
// deliverQueuedMessage bodies (Lane C) against a hand-rolled fake Prisma
// db/tx (no DB) and Lane C's own MockLineClient. `server-only` needs no
// vi.mock: vitest.config.ts aliases it to node_modules/server-only/empty.js
// for every test file (see modules/copilot/model.test.ts's own comment).
//
// Goal: show that Lane B's approveSuggestion and Lane C's line/service
// actually fit together end to end (enqueue inside Tx A, delivery after
// commit, a post-commit delivery failure still leaves the suggestion
// APPROVED), not just that each side's mocks match what the other side
// assumes.

const SECRET = 'approve-line-integration-secret'

type FakeLead = {
  id: string
  ownerId: string
  contactId: string
  score: number
  contact: { lineUserId: string | null }
}

type FakeUser = { id: string; role: 'ADMIN' | 'SALES'; name: string }

/**
 * Minimal in-memory stand-in for the slice of Prisma's `Db`/`Tx` API that
 * modules/copilot/service.ts's approveSuggestion and modules/line/service.ts's
 * enqueueLineMessage/deliverQueuedMessage actually call. `$transaction` just
 * invokes the callback with the same fake (no real isolation): good enough to
 * prove call order and data flow, not to replace Lane C's real-Postgres
 * send-retry.db.test.ts.
 */
function makeFakeDb(opts: {
  lead: FakeLead
  suggestion: Record<string, unknown> & { id: string; leadId: string; status: string }
  users?: FakeUser[]
}) {
  const events: string[] = []
  const createCalls: Array<Record<string, unknown>> = []

  const leads = new Map<string, FakeLead>([[opts.lead.id, opts.lead]])
  const suggestions = new Map<string, Record<string, unknown>>([[opts.suggestion.id, { ...opts.suggestion }]])
  const messages = new Map<string, Record<string, unknown>>()
  const activities: Array<Record<string, unknown>> = []
  const users = new Map<string, FakeUser>((opts.users ?? []).map((u) => [u.id, u]))
  let messageSeq = 0

  const db = {
    aiSuggestion: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = suggestions.get(where.id)
        if (!row) return null
        const lead = leads.get(row.leadId as string)
        return {
          ...row,
          lead: lead && { id: lead.id, ownerId: lead.ownerId, score: lead.score, contact: { lineUserId: lead.contact.lineUserId } },
        }
      },
      updateMany: async ({ where, data }: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
        const row = suggestions.get(where.id)
        if (!row || (where.status !== undefined && row.status !== where.status)) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = suggestions.get(where.id)
        if (!row) throw new Error('aiSuggestion not found: ' + where.id)
        return { ...row }
      },
    },
    lead: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = leads.get(where.id)
        if (!row) return null
        return { ...row, contact: { lineUserId: row.contact.lineUserId } }
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = leads.get(where.id)
        if (!row) throw new Error('lead not found: ' + where.id)
        Object.assign(row, data)
        return { ...row }
      },
    },
    message: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        messageSeq += 1
        const id = 'cmsg' + String(messageSeq).padStart(4, '0')
        const now = new Date()
        const row = {
          id,
          status: 'QUEUED',
          attemptCount: 0,
          lastError: null,
          lineRequestId: null,
          sentAt: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        }
        messages.set(id, row)
        createCalls.push({ ...data, __id: id })
        events.push('message.create')
        return { ...row }
      },
      findUnique: async ({ where, include }: { where: { id: string }; include?: { contact?: unknown; sentBy?: unknown } }) => {
        const row = messages.get(where.id)
        if (!row) return null
        const lead = row.leadId ? leads.get(row.leadId as string) : undefined
        const result: Record<string, unknown> = { ...row }
        if (include?.contact) result.contact = { lineUserId: lead?.contact.lineUserId ?? null }
        if (include?.sentBy) result.sentBy = row.sentById ? (users.get(row.sentById as string) ?? null) : null
        return result
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status?: string }
        data: Record<string, unknown>
      }) => {
        const row = messages.get(where.id)
        if (!row || (where.status !== undefined && row.status !== where.status)) return { count: 0 }
        const patch = { ...data }
        const attemptCount = patch.attemptCount as { increment?: number } | undefined
        if (attemptCount && typeof attemptCount === 'object') {
          row.attemptCount = ((row.attemptCount as number) ?? 0) + (attemptCount.increment ?? 0)
          delete patch.attemptCount
        }
        Object.assign(row, patch)
        row.updatedAt = new Date()
        return { count: 1 }
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = messages.get(where.id)
        if (!row) throw new Error('message not found: ' + where.id)
        return { ...row }
      },
    },
    activity: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'cact' + String(activities.length + 1), createdAt: new Date(), ...data }
        activities.push(row)
        events.push('activity.create:' + String(data.type))
        return row
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      events.push('tx.start')
      const result = await fn(db)
      events.push('tx.commit')
      return result
    },
  }

  return { db: db as unknown as Db, events, createCalls, messages, activities }
}

function makeActor(overrides: Partial<Extract<Actor, { kind: 'user' }>> = {}): Extract<Actor, { kind: 'user' }> {
  return { kind: 'user', id: 'user-owner-1', role: 'SALES', name: 'Owner', ...overrides }
}

function makeSuggestionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'suggestion-1',
    leadId: 'lead-1',
    status: 'PENDING',
    source: 'MODEL',
    lowConfidence: false,
    confidence: 0.8,
    summary: 'Summary text',
    score: 70,
    scoreReasons: ['r'],
    nextBestAction: null,
    draftReply: 'Hello there',
    flags: [],
    model: 'gemini-flash-latest',
    promptVersion: 'crm-copilot-v1',
    latencyMs: 120,
    errorCode: null,
    requestedById: 'user-owner-1',
    decidedById: null,
    decidedAt: null,
    createdAt: new Date('2026-09-15T00:00:00.000Z'),
    ...overrides,
  }
}

function makeLead(overrides: Partial<FakeLead> = {}): FakeLead {
  return {
    id: 'lead-1',
    ownerId: 'user-owner-1',
    contactId: 'contact-1',
    score: 40,
    contact: { lineUserId: 'Uabc123' },
    ...overrides,
  }
}

let line: MockLineClient

beforeEach(() => {
  line = new MockLineClient(SECRET)
})

describe('approveSuggestion + real modules/line/service (no DB, no mocked line/service)', () => {
  it('creates the queued Message with aiSuggestionId inside the Tx A callback, before commit', async () => {
    const lead = makeLead()
    const suggestion = makeSuggestionRow()
    const { db, events, createCalls } = makeFakeDb({
      lead,
      suggestion,
      users: [{ id: lead.ownerId, role: 'SALES', name: 'Owner' }],
    })
    const actor = makeActor({ id: lead.ownerId })

    const result = await approveSuggestion(
      { suggestionId: suggestion.id, actor, send: true, applyScore: false },
      { line, db },
    )

    // enqueue ran inside the transaction callback: 'message.create' sits
    // strictly between the first tx.start and its matching tx.commit.
    const txStart = events.indexOf('tx.start')
    const txCommit = events.indexOf('tx.commit')
    const messageCreate = events.indexOf('message.create')
    expect(txStart).toBeGreaterThanOrEqual(0)
    expect(messageCreate).toBeGreaterThan(txStart)
    expect(messageCreate).toBeLessThan(txCommit)

    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]).toMatchObject({
      aiSuggestionId: suggestion.id,
      leadId: lead.id,
      status: 'QUEUED',
      channel: 'LINE',
      direction: 'OUTBOUND',
      body: 'Hello there',
    })

    // Real deliverQueuedMessage ran too (not mocked): the suggestion comes
    // back APPROVED and the message ends up SENT via the mock LINE client.
    expect(result.suggestion.status).toBe('APPROVED')
    expect(result.message?.status).toBe('SENT')
  })

  it('runs delivery after commit, pushing through the real MockLineClient', async () => {
    const lead = makeLead()
    const suggestion = makeSuggestionRow({ id: 'suggestion-2' })
    const { db, events } = makeFakeDb({
      lead,
      suggestion,
      users: [{ id: lead.ownerId, role: 'SALES', name: 'Owner' }],
    })
    const actor = makeActor({ id: lead.ownerId })

    const pushOrder: string[] = []
    const originalPush = line.push.bind(line)
    vi.spyOn(line, 'push').mockImplementation(async (...args) => {
      pushOrder.push('push')
      events.push('line.push')
      return originalPush(...args)
    })

    await approveSuggestion({ suggestionId: suggestion.id, actor, send: true, applyScore: false }, { line, db })

    // Exactly one push, and it happened strictly after Tx A's commit.
    expect(pushOrder).toEqual(['push'])
    const firstTxCommit = events.indexOf('tx.commit')
    const push = events.indexOf('line.push')
    expect(push).toBeGreaterThan(firstTxCommit)

    expect(line.sent).toHaveLength(1)
    expect(line.sent[0]).toMatchObject({ to: lead.contact.lineUserId, messages: [{ type: 'text', text: 'Hello there' }] })
  })

  it('keeps the suggestion APPROVED and returns the still-QUEUED message when delivery throws after commit', async () => {
    const lead = makeLead()
    const suggestion = makeSuggestionRow({ id: 'suggestion-3' })
    const { db, activities } = makeFakeDb({
      lead,
      suggestion,
      users: [{ id: lead.ownerId, role: 'SALES', name: 'Owner' }],
    })
    const actor = makeActor({ id: lead.ownerId })

    vi.spyOn(line, 'push').mockRejectedValue(new Error('LINE is down'))

    const result = await approveSuggestion(
      { suggestionId: suggestion.id, actor, send: true, applyScore: false },
      { line, db },
    )

    // approveSuggestion swallows the post-commit delivery error: the
    // suggestion stays APPROVED (Tx A already committed) and the message
    // comes back in whatever state deliverQueuedMessage left it in (QUEUED:
    // Tx B never ran because the throw happened before it).
    expect(result.suggestion.status).toBe('APPROVED')
    expect(result.message).not.toBeNull()
    expect(result.message?.status).toBe('QUEUED')
    expect(result.message?.attemptCount).toBe(1)

    // Tx B (the SENT/FAILED transition + its Activity) never ran: only the
    // AI_SUGGESTION_APPROVED activity from Tx A was written.
    expect(activities).toHaveLength(1)
    expect(activities[0]).toMatchObject({ type: 'AI_SUGGESTION_APPROVED' })
  })
})
