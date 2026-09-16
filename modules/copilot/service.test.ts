import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/lib/db'
import type { Actor } from '@/lib/auth/dal'

// [D] modules/copilot/service.test.ts (G6). No DB: every call passes a fake
// `db`/`tx` in `deps`, and '@/modules/line/service' + '@/modules/copilot/model'
// are mocked so no real network or env-dependent construction happens. See
// S4-plan.md section G6 and section C.

vi.mock('server-only', () => ({}))

vi.mock('@/modules/line/service', () => ({
  enqueueLineMessage: vi.fn(),
  deliverQueuedMessage: vi.fn(),
}))

vi.mock('@/modules/copilot/model', () => ({
  getSuggestDeps: vi.fn(() => ({ copilot: null, timeoutMs: 50, minConfidence: 0.5 })),
}))

import { enqueueLineMessage, deliverQueuedMessage } from '@/modules/line/service'
import { approveSuggestion, rejectSuggestion, requestInsight } from '@/modules/copilot/service'

const order: string[] = []

function makeActor(overrides: Partial<Extract<Actor, { kind: 'user' }>> = {}): Extract<Actor, { kind: 'user' }> {
  return { kind: 'user', id: 'cuser00000000000000000001', role: 'SALES', name: 'Tester', ...overrides }
}

function makeSuggestionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'csugg0000000000000000001',
    leadId: 'clead00000000000000000001',
    status: 'PENDING',
    source: 'MODEL',
    lowConfidence: false,
    confidence: 0.8,
    summary: 'Summary text',
    score: 70,
    scoreReasons: ['Stage QUALIFIED: base score 45'],
    nextBestAction: { type: 'CALL', title: 'Call', rationale: 'Because', suggestedStage: null, dueInDays: 1 },
    draftReply: 'Hello there',
    flags: [],
    model: 'gemini-flash-latest',
    promptVersion: 'crm-copilot-v1',
    latencyMs: 120,
    errorCode: null,
    requestedById: 'cuser00000000000000000001',
    decidedById: null,
    decidedAt: null,
    createdAt: new Date('2026-09-15T00:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  order.length = 0
  vi.mocked(enqueueLineMessage).mockReset()
  vi.mocked(deliverQueuedMessage).mockReset()
})

describe('requestInsight', () => {
  function makeLeadContextRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'clead00000000000000000001',
      title: 'Website inquiry',
      stage: 'QUALIFIED',
      source: 'WEBSITE',
      value: null,
      currency: 'THB',
      stageChangedAt: new Date('2026-09-01T00:00:00Z'),
      createdAt: new Date('2026-08-01T00:00:00Z'),
      owner: { name: 'Owner' },
      company: null,
      contact: { firstName: 'Nok', lastName: null, lineUserId: 'U123', company: null, tags: [] },
      messages: [],
      activities: [],
      ...overrides,
    }
  }

  it('supersedes pending suggestions, creates a PENDING row with requestedById, and writes AI_SUGGESTION_CREATED, never touching Lead or Message', async () => {
    const actor = makeActor()
    const leadRow = makeLeadContextRow()
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue(undefined),
      aiSuggestion: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue(makeSuggestionRow({ requestedById: actor.id })),
      },
      activity: { create: vi.fn().mockResolvedValue({}) },
      lead: { update: vi.fn() },
      message: { create: vi.fn() },
    }
    const db = {
      lead: { findUnique: vi.fn().mockResolvedValue(leadRow) },
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    } as unknown as Db

    const suggest = vi.fn().mockResolvedValue({
      output: {
        summary: 'x',
        score: 50,
        scoreReasons: ['r'],
        nextBestAction: { type: 'CALL', title: 't', rationale: 'r', suggestedStage: null, dueInDays: 1 },
        draftReply: null,
        confidence: 0.9,
        flags: [],
      },
      source: 'MODEL',
      lowConfidence: false,
      errorCode: null,
      model: 'gemini-flash-latest',
      promptVersion: 'crm-copilot-v1',
      latencyMs: 10,
    })

    const created = await requestInsight({ leadId: leadRow.id, actor }, { db, suggest })

    expect(tx.aiSuggestion.updateMany).toHaveBeenCalledWith({
      where: { leadId: leadRow.id, status: 'PENDING' },
      data: { status: 'SUPERSEDED' },
    })
    expect(tx.aiSuggestion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ leadId: leadRow.id, status: 'PENDING', requestedById: actor.id }),
      }),
    )
    expect(tx.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'AI_SUGGESTION_CREATED', leadId: leadRow.id }),
      }),
    )
    expect(tx.lead.update).not.toHaveBeenCalled()
    expect(tx.message.create).not.toHaveBeenCalled()
    expect(created).toBeDefined()
  })

  it('runs $queryRaw (FOR UPDATE) before the supersede updateMany, then create, then the activity write (S10 regression)', async () => {
    const actor = makeActor()
    const leadRow = makeLeadContextRow()
    const callOrder: string[] = []
    const tx = {
      $queryRaw: vi.fn().mockImplementation(async () => {
        callOrder.push('queryRaw')
        return undefined
      }),
      aiSuggestion: {
        updateMany: vi.fn().mockImplementation(async () => {
          callOrder.push('updateMany')
          return { count: 1 }
        }),
        create: vi.fn().mockImplementation(async () => {
          callOrder.push('create')
          return makeSuggestionRow({ requestedById: actor.id })
        }),
      },
      activity: {
        create: vi.fn().mockImplementation(async () => {
          callOrder.push('activity')
          return {}
        }),
      },
      lead: { update: vi.fn() },
      message: { create: vi.fn() },
    }
    const db = {
      lead: { findUnique: vi.fn().mockResolvedValue(leadRow) },
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    } as unknown as Db

    const suggest = vi.fn().mockResolvedValue({
      output: {
        summary: 'x',
        score: 50,
        scoreReasons: ['r'],
        nextBestAction: { type: 'CALL', title: 't', rationale: 'r', suggestedStage: null, dueInDays: 1 },
        draftReply: null,
        confidence: 0.9,
        flags: [],
      },
      source: 'MODEL',
      lowConfidence: false,
      errorCode: null,
      model: 'gemini-flash-latest',
      promptVersion: 'crm-copilot-v1',
      latencyMs: 10,
    })

    await requestInsight({ leadId: leadRow.id, actor }, { db, suggest })

    expect(callOrder).toEqual(['queryRaw', 'updateMany', 'create', 'activity'])
  })

  it('throws NOT_FOUND without ever calling suggest when the lead does not exist', async () => {
    const actor = makeActor()
    const db = { lead: { findUnique: vi.fn().mockResolvedValue(null) } } as unknown as Db
    const suggest = vi.fn()

    await expect(
      requestInsight({ leadId: 'clead00000000000000000002', actor }, { db, suggest }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(suggest).not.toHaveBeenCalled()
  })

  it('throws FORBIDDEN for a system actor, without reading the lead', async () => {
    const findUnique = vi.fn()
    const db = { lead: { findUnique } } as unknown as Db
    const suggest = vi.fn()

    await expect(
      requestInsight(
        { leadId: 'clead00000000000000000001', actor: { kind: 'system', source: 'line-webhook' } },
        { db, suggest },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(suggest).not.toHaveBeenCalled()
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('falls back to a FALLBACK/NO_API_KEY row when deps.suggest is not overridden', async () => {
    const actor = makeActor()
    const leadRow = makeLeadContextRow()
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue(undefined),
      aiSuggestion: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue(makeSuggestionRow()),
      },
      activity: { create: vi.fn().mockResolvedValue({}) },
    }
    const db = {
      lead: { findUnique: vi.fn().mockResolvedValue(leadRow) },
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    } as unknown as Db

    await requestInsight({ leadId: leadRow.id, actor }, { db })

    const createArg = tx.aiSuggestion.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(createArg.data.source).toBe('FALLBACK')
    expect(createArg.data.errorCode).toBe('NO_API_KEY')
    expect(createArg.data.model).toBeNull()
  })
})

describe('approveSuggestion', () => {
  const suggestionId = 'csugg0000000000000000001'
  const leadId = 'clead00000000000000000001'

  function makeExistingRow(overrides: Record<string, unknown> = {}) {
    return {
      id: suggestionId,
      status: 'PENDING',
      draftReply: 'Hello there',
      source: 'MODEL',
      score: 70,
      lead: { id: leadId, ownerId: 'cuser00000000000000000001', score: 40, contact: { lineUserId: 'U123' } },
      ...overrides,
    }
  }

  function makeApproveTx(overrides: Record<string, unknown> = {}) {
    return {
      aiSuggestion: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(makeSuggestionRow({ id: suggestionId, status: 'APPROVED' })),
      },
      lead: { update: vi.fn().mockResolvedValue({}) },
      activity: { create: vi.fn().mockResolvedValue({}) },
      ...overrides,
    }
  }

  function makeApproveDb(existing: unknown, tx: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
    return {
      aiSuggestion: { findUnique: vi.fn().mockResolvedValue(existing) },
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => {
        const result = await fn(tx)
        order.push('commit')
        return result
      }),
      message: { findUnique: vi.fn() },
      ...overrides,
    } as unknown as Db
  }

  it('runs enqueue -> commit -> deliver in exactly that order, with the tx as enqueueLineMessage’s first arg', async () => {
    const existing = makeExistingRow()
    const tx = makeApproveTx()
    const db = makeApproveDb(existing, tx)
    let capturedTx: unknown
    vi.mocked(enqueueLineMessage).mockImplementation(async (txArg) => {
      capturedTx = txArg
      order.push('enqueue')
      return { id: 'cmsg00000000000000000001' } as never
    })
    vi.mocked(deliverQueuedMessage).mockImplementation(async () => {
      order.push('deliver')
      return { id: 'cmsg00000000000000000001', status: 'SENT' } as never
    })

    const actor = makeActor({ id: existing.lead.ownerId })
    await approveSuggestion({ suggestionId, actor, send: true, applyScore: false }, { line: {} as never, db })

    expect(order).toEqual(['enqueue', 'commit', 'deliver'])
    expect(capturedTx).toBe(tx)
  })

  it('passes text, aiSuggestionId and actor to enqueueLineMessage', async () => {
    const existing = makeExistingRow()
    const tx = makeApproveTx()
    const db = makeApproveDb(existing, tx)
    vi.mocked(enqueueLineMessage).mockResolvedValue({ id: 'cmsg00000000000000000001' } as never)
    vi.mocked(deliverQueuedMessage).mockResolvedValue({ id: 'cmsg00000000000000000001', status: 'SENT' } as never)

    const actor = makeActor({ id: existing.lead.ownerId })
    await approveSuggestion(
      { suggestionId, actor, send: true, applyScore: false, replyText: 'Edited text' },
      { line: {} as never, db },
    )

    expect(enqueueLineMessage).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ leadId, text: 'Edited text', actor, aiSuggestionId: suggestionId }),
    )
  })

  it('marks edited true when replyText differs from the trimmed original draft', async () => {
    const existing = makeExistingRow({ draftReply: 'Original' })
    const tx = makeApproveTx()
    const db = makeApproveDb(existing, tx)
    const actor = makeActor({ id: existing.lead.ownerId })

    await approveSuggestion(
      { suggestionId, actor, send: false, applyScore: false, replyText: 'Changed' },
      { line: {} as never, db },
    )

    expect(tx.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ meta: expect.objectContaining({ edited: true }) }) }),
    )
  })

  it('marks edited false when replyText equals the trimmed original draft', async () => {
    const existing = makeExistingRow({ draftReply: 'Same text' })
    const tx = makeApproveTx()
    const db = makeApproveDb(existing, tx)
    const actor = makeActor({ id: existing.lead.ownerId })

    await approveSuggestion(
      { suggestionId, actor, send: false, applyScore: false, replyText: 'Same text' },
      { line: {} as never, db },
    )

    expect(tx.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ meta: expect.objectContaining({ edited: false }) }) }),
    )
  })

  it('applies the suggestion score to the lead and writes SCORE_APPLIED when applyScore is true', async () => {
    const existing = makeExistingRow({ score: 82 })
    const tx = makeApproveTx()
    const db = makeApproveDb(existing, tx)
    const actor = makeActor({ id: existing.lead.ownerId })

    await approveSuggestion({ suggestionId, actor, send: false, applyScore: true }, { line: {} as never, db })

    expect(tx.lead.update).toHaveBeenCalledWith({ where: { id: leadId }, data: expect.objectContaining({ score: 82 }) })
    expect(tx.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'SCORE_APPLIED',
          meta: expect.objectContaining({ suggestionId, score: 82, previousScore: existing.lead.score }),
        }),
      }),
    )
  })

  it('does not enqueue and returns a null message when send is false', async () => {
    const existing = makeExistingRow()
    const tx = makeApproveTx()
    const db = makeApproveDb(existing, tx)
    const actor = makeActor({ id: existing.lead.ownerId })

    const result = await approveSuggestion({ suggestionId, actor, send: false, applyScore: false }, { line: {} as never, db })

    expect(enqueueLineMessage).not.toHaveBeenCalled()
    expect(result.message).toBeNull()
  })

  it('throws UNPROCESSABLE when send is true but the contact has no LINE, without opening a transaction', async () => {
    const existing = makeExistingRow({ lead: { id: leadId, ownerId: 'cuser00000000000000000001', score: 0, contact: { lineUserId: null } } })
    const db = makeApproveDb(existing, makeApproveTx())
    const actor = makeActor({ id: existing.lead.ownerId })

    await expect(
      approveSuggestion({ suggestionId, actor, send: true, applyScore: false }, { line: {} as never, db }),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE' })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('throws UNPROCESSABLE when send is true but there is no reply text, without opening a transaction', async () => {
    const existing = makeExistingRow({ draftReply: null })
    const db = makeApproveDb(existing, makeApproveTx())
    const actor = makeActor({ id: existing.lead.ownerId })

    await expect(
      approveSuggestion({ suggestionId, actor, send: true, applyScore: false }, { line: {} as never, db }),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE' })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('throws CONFLICT immediately when the suggestion is no longer PENDING, without opening a transaction', async () => {
    const existing = makeExistingRow({ status: 'APPROVED' })
    const db = makeApproveDb(existing, makeApproveTx())
    const actor = makeActor({ id: existing.lead.ownerId })

    await expect(
      approveSuggestion({ suggestionId, actor, send: false, applyScore: false }, { line: {} as never, db }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('throws CONFLICT when a concurrent decision wins the race inside the transaction, without enqueueing or updating the lead', async () => {
    const existing = makeExistingRow()
    const tx = makeApproveTx({
      aiSuggestion: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findUniqueOrThrow: vi.fn() },
    })
    const db = makeApproveDb(existing, tx)
    const actor = makeActor({ id: existing.lead.ownerId })

    await expect(
      approveSuggestion({ suggestionId, actor, send: true, applyScore: true }, { line: {} as never, db }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(enqueueLineMessage).not.toHaveBeenCalled()
    expect(tx.lead.update).not.toHaveBeenCalled()
  })

  it('throws FORBIDDEN for a SALES user who does not own the lead', async () => {
    const existing = makeExistingRow({ lead: { id: leadId, ownerId: 'cuser00000000000000000099', score: 0, contact: { lineUserId: 'U1' } } })
    const db = makeApproveDb(existing, makeApproveTx())
    const actor = makeActor({ id: 'cuser00000000000000000002', role: 'SALES' })

    await expect(
      approveSuggestion({ suggestionId, actor, send: false, applyScore: false }, { line: {} as never, db }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('allows an ADMIN who does not own the lead', async () => {
    const existing = makeExistingRow({ lead: { id: leadId, ownerId: 'cuser00000000000000000099', score: 0, contact: { lineUserId: 'U1' } } })
    const tx = makeApproveTx()
    const db = makeApproveDb(existing, tx)
    const actor = makeActor({ id: 'cuser00000000000000000003', role: 'ADMIN' })

    const result = await approveSuggestion({ suggestionId, actor, send: false, applyScore: false }, { line: {} as never, db })
    expect(result.suggestion).toBeDefined()
  })

  it('throws NOT_FOUND when the suggestion does not exist', async () => {
    const db = makeApproveDb(null, makeApproveTx())
    const actor = makeActor()

    await expect(
      approveSuggestion({ suggestionId, actor, send: false, applyScore: false }, { line: {} as never, db }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('keeps the suggestion APPROVED and re-reads the message when delivery throws after commit', async () => {
    const existing = makeExistingRow()
    const tx = makeApproveTx()
    const approvedRow = makeSuggestionRow({ id: suggestionId, status: 'APPROVED' })
    tx.aiSuggestion.findUniqueOrThrow = vi.fn().mockResolvedValue(approvedRow)
    const queuedMessage = { id: 'cmsg00000000000000000001', status: 'QUEUED' }
    const messageFindUnique = vi.fn().mockResolvedValue(queuedMessage)
    const db = makeApproveDb(existing, tx, { message: { findUnique: messageFindUnique } })
    vi.mocked(enqueueLineMessage).mockResolvedValue(queuedMessage as never)
    vi.mocked(deliverQueuedMessage).mockRejectedValue(new Error('LINE is down'))

    const actor = makeActor({ id: existing.lead.ownerId })
    const result = await approveSuggestion({ suggestionId, actor, send: true, applyScore: false }, { line: {} as never, db })

    expect(result.suggestion.status).toBe('APPROVED')
    expect(result.message).toEqual(queuedMessage)
    expect(messageFindUnique).toHaveBeenCalledWith({ where: { id: queuedMessage.id } })
  })
})

describe('rejectSuggestion', () => {
  const suggestionId = 'csugg0000000000000000002'
  const leadId = 'clead00000000000000000002'

  function makeExisting(overrides: Record<string, unknown> = {}) {
    return { id: suggestionId, status: 'PENDING', lead: { id: leadId, ownerId: 'cuser00000000000000000001' }, ...overrides }
  }

  function makeRejectDb(existing: unknown, txOverrides: Record<string, unknown> = {}) {
    const tx = {
      aiSuggestion: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(makeSuggestionRow({ id: suggestionId, status: 'REJECTED' })),
      },
      activity: { create: vi.fn().mockResolvedValue({}) },
      ...txOverrides,
    }
    const db = {
      aiSuggestion: { findUnique: vi.fn().mockResolvedValue(existing) },
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    } as unknown as Db
    return { db, tx }
  }

  it('marks the suggestion REJECTED and writes the trimmed reason as the activity body', async () => {
    const existing = makeExisting()
    const { db, tx } = makeRejectDb(existing)
    const actor = makeActor({ id: existing.lead.ownerId })

    await rejectSuggestion({ suggestionId, actor, reason: '  not interested  ' }, db)

    expect(tx.aiSuggestion.updateMany).toHaveBeenCalledWith({
      where: { id: suggestionId, status: 'PENDING' },
      data: expect.objectContaining({ status: 'REJECTED' }),
    })
    expect(tx.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'AI_SUGGESTION_REJECTED', body: 'not interested' }) }),
    )
  })

  it('writes a null body when the reason is empty', async () => {
    const existing = makeExisting()
    const { db, tx } = makeRejectDb(existing)
    const actor = makeActor({ id: existing.lead.ownerId })

    await rejectSuggestion({ suggestionId, actor, reason: '' }, db)

    expect(tx.activity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ body: null }) }))
  })

  it('throws CONFLICT when the suggestion is no longer PENDING at update time', async () => {
    const existing = makeExisting()
    const { db } = makeRejectDb(existing, {
      aiSuggestion: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findUniqueOrThrow: vi.fn() },
    })
    const actor = makeActor({ id: existing.lead.ownerId })

    await expect(rejectSuggestion({ suggestionId, actor }, db)).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('throws FORBIDDEN for a SALES user who does not own the lead', async () => {
    const existing = makeExisting({ lead: { id: leadId, ownerId: 'cuser00000000000000000099' } })
    const { db } = makeRejectDb(existing)
    const actor = makeActor({ id: 'cuser00000000000000000002', role: 'SALES' })

    await expect(rejectSuggestion({ suggestionId, actor }, db)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('throws NOT_FOUND when the suggestion does not exist', async () => {
    const { db } = makeRejectDb(null)
    const actor = makeActor()

    await expect(rejectSuggestion({ suggestionId, actor }, db)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
