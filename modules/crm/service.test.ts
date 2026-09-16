import { describe, expect, it, vi } from 'vitest'
import type { Db, Tx } from '@/lib/db'
import type { Actor } from '@/lib/auth/dal'
import { changeStage, createLead, deleteContact, parseIdOrNotFound, updateLead } from '@/modules/crm/service'
import { buildLeadWhere, findTimelinePage, mergeTimelinePage } from '@/modules/crm/repository'
import type { TimelineItem } from '@/lib/contracts/timeline'

// [A] modules/crm/service.test.ts: unit tests against a mocked Prisma client
// (no real database), per docs/design.md section 9. Covers the 7 frozen
// bodies' branch logic plus the pure repository helpers they lean on.

function createFakeDb() {
  const tx = {
    lead: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    activity: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'cact0000001', ...data })),
    },
    user: { findUnique: vi.fn() },
    contact: { findUnique: vi.fn(), count: vi.fn(), delete: vi.fn() },
    company: { findUnique: vi.fn() },
    message: { count: vi.fn() },
  }
  const db = { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as Db
  return { db, tx }
}

// `satisfies` (not `: Actor`) keeps the narrower `kind: 'user'` literal type
// so `.id` / `.role` are accessible below without re-narrowing the union.
const admin = { kind: 'user', id: 'cadmin0000001', role: 'ADMIN', name: 'Admin One' } satisfies Actor
const salesOwner = { kind: 'user', id: 'csales0000001', role: 'SALES', name: 'Sales Owner' } satisfies Actor
const salesOther = { kind: 'user', id: 'csales0000002', role: 'SALES', name: 'Sales Other' } satisfies Actor

const leadId = 'clead00000001'
const contactId1 = 'ccontact0001'

describe('changeStage', () => {
  it('returns changed:false and writes no Activity when the stage is unchanged', async () => {
    const { db, tx } = createFakeDb()
    const lead = { id: leadId, stage: 'NEW', ownerId: salesOwner.id }
    tx.lead.findUnique.mockResolvedValue(lead)

    const result = await changeStage({ leadId, to: 'NEW', actor: salesOwner }, db)

    expect(result).toEqual({ lead, changed: false })
    expect(tx.lead.updateMany).not.toHaveBeenCalled()
    expect(tx.activity.create).not.toHaveBeenCalled()
  })

  it('forbids a non-owner SALES user from changing the stage', async () => {
    const { db, tx } = createFakeDb()
    tx.lead.findUnique.mockResolvedValue({ id: leadId, stage: 'NEW', ownerId: salesOwner.id })

    let error: unknown
    try {
      await changeStage({ leadId, to: 'QUALIFIED', actor: salesOther }, db)
    } catch (err) {
      error = err
    }

    expect(error).toMatchObject({ code: 'FORBIDDEN' })
    expect(tx.lead.updateMany).not.toHaveBeenCalled()
  })

  it('raises CONFLICT and writes no Activity when the stage changed concurrently', async () => {
    const { db, tx } = createFakeDb()
    tx.lead.findUnique.mockResolvedValue({ id: leadId, stage: 'NEW', ownerId: salesOwner.id })
    tx.lead.updateMany.mockResolvedValue({ count: 0 })

    let error: unknown
    try {
      await changeStage({ leadId, to: 'QUALIFIED', actor: salesOwner }, db)
    } catch (err) {
      error = err
    }

    expect(error).toMatchObject({ code: 'CONFLICT' })
    expect(tx.activity.create).not.toHaveBeenCalled()
  })

  it('sets lostReason and a Date closedAt, and writes one STAGE_CHANGED activity, for NEW -> LOST', async () => {
    const { db, tx } = createFakeDb()
    tx.lead.findUnique.mockResolvedValue({ id: leadId, stage: 'NEW', ownerId: salesOwner.id })
    tx.lead.updateMany.mockResolvedValue({ count: 1 })
    tx.lead.findUniqueOrThrow.mockResolvedValue({ id: leadId, stage: 'LOST', ownerId: salesOwner.id })

    const result = await changeStage({ leadId, to: 'LOST', reason: 'budget cut', actor: salesOwner }, db)

    expect(result.changed).toBe(true)
    const updateManyArgs = tx.lead.updateMany.mock.calls[0][0]
    expect(updateManyArgs.data.lostReason).toBe('budget cut')
    expect(updateManyArgs.data.closedAt).toBeInstanceOf(Date)
    expect(tx.activity.create).toHaveBeenCalledTimes(1)
    expect(tx.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'STAGE_CHANGED',
        meta: { from: 'NEW', to: 'LOST', reason: 'budget cut' },
      }),
    })
  })

  it('allows an ADMIN to move a lead they do not own, with closedAt and lostReason null', async () => {
    const { db, tx } = createFakeDb()
    tx.lead.findUnique.mockResolvedValue({ id: leadId, stage: 'NEW', ownerId: salesOwner.id })
    tx.lead.updateMany.mockResolvedValue({ count: 1 })
    tx.lead.findUniqueOrThrow.mockResolvedValue({ id: leadId, stage: 'QUALIFIED', ownerId: salesOwner.id })

    await changeStage({ leadId, to: 'QUALIFIED', actor: admin }, db)

    const updateManyArgs = tx.lead.updateMany.mock.calls[0][0]
    expect(updateManyArgs.data.closedAt).toBeNull()
    expect(updateManyArgs.data.lostReason).toBeNull()
  })

  // S15 round 2: from S14 round 2's change moving the `from` value out of the
  // transaction callback's closure and returning it from `$transaction`
  // instead. Assert both halves of that change here: the public return value
  // never leaks `from` (shape-wise), and the log line emitted after commit
  // still carries the right from/to (see the logging describe block below
  // too, which already covers the no-email assertion).
  it('returns only { lead, changed } (no from) and logs from/to once after commit', async () => {
    const { db, tx } = createFakeDb()
    tx.lead.findUnique.mockResolvedValue({ id: leadId, stage: 'NEW', ownerId: salesOwner.id })
    tx.lead.updateMany.mockResolvedValue({ count: 1 })
    tx.lead.findUniqueOrThrow.mockResolvedValue({ id: leadId, stage: 'QUALIFIED', ownerId: salesOwner.id })

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = await changeStage({ leadId, to: 'QUALIFIED', actor: salesOwner }, db)
    const lines = spy.mock.calls.map((call) => call[0] as string)
    spy.mockRestore()

    expect(Object.keys(result).sort()).toEqual(['changed', 'lead'])
    const stageChangedLines = lines.filter((line) => JSON.parse(line).event === 'crm.stage_changed')
    expect(stageChangedLines).toHaveLength(1)
    expect(JSON.parse(stageChangedLines[0])).toMatchObject({ from: 'NEW', to: 'QUALIFIED' })
  })
})

// S15: S13 review finding 3 (log events after commit, no email). `log()`
// writes one JSON line via console.log/console.error (see lib/log.ts), so we
// spy on console.log the same way tests/security.test.ts already does,
// rather than mocking the frozen lib/log.ts module itself.
describe('changeStage logging (S13 finding 3)', () => {
  it('logs crm.stage_changed exactly once, after commit, with no email field', async () => {
    const { db, tx } = createFakeDb()
    tx.lead.findUnique.mockResolvedValue({ id: leadId, stage: 'NEW', ownerId: salesOwner.id })
    tx.lead.updateMany.mockResolvedValue({ count: 1 })
    tx.lead.findUniqueOrThrow.mockResolvedValue({ id: leadId, stage: 'QUALIFIED', ownerId: salesOwner.id })

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await changeStage({ leadId, to: 'QUALIFIED', actor: salesOwner }, db)
    const lines = spy.mock.calls.map((call) => call[0] as string)
    spy.mockRestore()

    const stageChangedLines = lines.filter((line) => JSON.parse(line).event === 'crm.stage_changed')
    expect(stageChangedLines).toHaveLength(1)
    const parsed = JSON.parse(stageChangedLines[0])
    expect(parsed).toMatchObject({ leadId, from: 'NEW', to: 'QUALIFIED', userId: salesOwner.id })
    // No `not.toContain('@')` check here: `Actor` (kind: 'user') has no
    // email field at all (see lib/auth/dal.ts, frozen), and the log call in
    // changeStage only ever passes leadId/from/to/userId, none of which can
    // structurally contain an '@' from this fixture. Asserting it anyway
    // would always pass regardless of whether redaction works, which is
    // exactly the tautology flagged at S15 review; the real "no email
    // leaks" coverage for a value that legitimately carries one lives in
    // tests/security.test.ts against lib/log.ts's redaction itself.
  })

  it('does not log crm.stage_changed when the stage does not actually change', async () => {
    const { db, tx } = createFakeDb()
    tx.lead.findUnique.mockResolvedValue({ id: leadId, stage: 'NEW', ownerId: salesOwner.id })

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await changeStage({ leadId, to: 'NEW', actor: salesOwner }, db)
    const lines = spy.mock.calls.map((call) => call[0] as string)
    spy.mockRestore()

    expect(lines.some((line) => JSON.parse(line).event === 'crm.stage_changed')).toBe(false)
  })

  it('does not log crm.stage_changed when the transaction rolls back (CONFLICT)', async () => {
    const { db, tx } = createFakeDb()
    tx.lead.findUnique.mockResolvedValue({ id: leadId, stage: 'NEW', ownerId: salesOwner.id })
    tx.lead.updateMany.mockResolvedValue({ count: 0 })

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(changeStage({ leadId, to: 'QUALIFIED', actor: salesOwner }, db)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    const lines = spy.mock.calls.map((call) => call[0] as string)
    spy.mockRestore()

    expect(lines.some((line) => JSON.parse(line).event === 'crm.stage_changed')).toBe(false)
  })
})

describe('updateLead', () => {
  it('forbids a SALES owner from reassigning the owner', async () => {
    const { db, tx } = createFakeDb()
    tx.lead.findUnique.mockResolvedValue({ id: leadId, ownerId: salesOwner.id, contactId: contactId1 })

    let error: unknown
    try {
      await updateLead(leadId, { ownerId: salesOther.id }, salesOwner, db)
    } catch (err) {
      error = err
    }

    expect(error).toMatchObject({ code: 'FORBIDDEN' })
    expect(tx.lead.update).not.toHaveBeenCalled()
  })

  it('lets an ADMIN reassign the owner and writes an OWNER_CHANGED activity', async () => {
    const { db, tx } = createFakeDb()
    tx.lead.findUnique.mockResolvedValue({ id: leadId, ownerId: salesOwner.id, contactId: contactId1 })
    tx.user.findUnique.mockResolvedValue({ active: true })
    tx.lead.update.mockResolvedValue({ id: leadId, ownerId: salesOther.id })

    const result = await updateLead(leadId, { ownerId: salesOther.id }, admin, db)

    expect(result.ownerId).toBe(salesOther.id)
    expect(tx.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'OWNER_CHANGED',
        meta: { from: salesOwner.id, to: salesOther.id },
      }),
    })
  })

  // S13 finding 5, updateLead side of the guard (see createLead above).
  it('rejects a value of ten billion (VALIDATION_FAILED on the value field)', async () => {
    const { db } = createFakeDb()

    let error: unknown
    try {
      await updateLead(leadId, { value: 1e10 }, salesOwner, db)
    } catch (err) {
      error = err
    }

    expect(error).toMatchObject({ code: 'VALIDATION_FAILED', fieldErrors: { value: expect.any(Array) } })
  })

  it('allows a value just under the ten billion guard', async () => {
    const { db, tx } = createFakeDb()
    tx.lead.findUnique.mockResolvedValue({ id: leadId, ownerId: salesOwner.id, contactId: contactId1 })
    tx.lead.update.mockResolvedValue({ id: leadId, value: 9_999_999_999.99 })

    const result = await updateLead(leadId, { value: 9_999_999_999.99 }, salesOwner, db)

    expect(result.value).toBe(9_999_999_999.99)
  })

  // S15 round 2: from S14 round 2's guard rewrite (round to cents before
  // comparing to 1e12, not the raw float against 1e10). 9_999_999_999.999 is
  // itself just under 1e10, but rounds to 10_000_000_000.00 once stored in
  // the Decimal(12,2) column, so it must still be rejected; the boundary
  // value that fits (9_999_999_999.99) is covered just above.
  it('rejects a value of 9_999_999_999.999 that rounds to ten billion cents', async () => {
    const { db } = createFakeDb()

    let error: unknown
    try {
      await updateLead(leadId, { value: 9_999_999_999.999 }, salesOwner, db)
    } catch (err) {
      error = err
    }

    expect(error).toMatchObject({ code: 'VALIDATION_FAILED', fieldErrors: { value: expect.any(Array) } })
  })
})

describe('createLead', () => {
  it('forbids a SALES user from creating a lead for another owner', async () => {
    const { db } = createFakeDb()

    let error: unknown
    try {
      await createLead(
        { title: 'New deal', contactId: contactId1, source: 'MANUAL', ownerId: salesOther.id },
        salesOwner,
        db,
      )
    } catch (err) {
      error = err
    }

    expect(error).toMatchObject({ code: 'FORBIDDEN' })
  })

  // S13 finding 5: lib/contracts/crm.ts allows `value` up to 1e10, but
  // Lead.value is Decimal(12,2), whose largest representable value is
  // 9,999,999,999.99. The service-layer guard rejects >= 1e10.
  it('rejects a value of ten billion (VALIDATION_FAILED on the value field)', async () => {
    const { db } = createFakeDb()

    let error: unknown
    try {
      await createLead({ title: 'Big deal', contactId: contactId1, source: 'MANUAL', value: 1e10 }, salesOwner, db)
    } catch (err) {
      error = err
    }

    expect(error).toMatchObject({ code: 'VALIDATION_FAILED', fieldErrors: { value: expect.any(Array) } })
  })

  it('allows a value just under the ten billion guard', async () => {
    const { db, tx } = createFakeDb()
    tx.contact.findUnique.mockResolvedValue({ id: contactId1, companyId: null })
    tx.user.findUnique.mockResolvedValue({ active: true })
    tx.lead.create.mockResolvedValue({ id: leadId, value: 9_999_999_999.99 })

    const result = await createLead(
      { title: 'Big deal', contactId: contactId1, source: 'MANUAL', value: 9_999_999_999.99 },
      salesOwner,
      db,
    )

    expect(result.value).toBe(9_999_999_999.99)
    expect(tx.lead.create).toHaveBeenCalled()
  })

  // S15 round 2: createLead side of the 9_999_999_999.999 boundary (see the
  // matching updateLead test above).
  it('rejects a value of 9_999_999_999.999 that rounds to ten billion cents', async () => {
    const { db } = createFakeDb()

    let error: unknown
    try {
      await createLead(
        { title: 'Big deal', contactId: contactId1, source: 'MANUAL', value: 9_999_999_999.999 },
        salesOwner,
        db,
      )
    } catch (err) {
      error = err
    }

    expect(error).toMatchObject({ code: 'VALIDATION_FAILED', fieldErrors: { value: expect.any(Array) } })
  })
})

describe('deleteContact', () => {
  it('refuses to delete a contact that still has leads', async () => {
    const { db, tx } = createFakeDb()
    tx.contact.findUnique.mockResolvedValue({ id: contactId1 })
    tx.lead.count.mockResolvedValue(1)

    let error: unknown
    try {
      await deleteContact(contactId1, admin, db)
    } catch (err) {
      error = err
    }

    expect(error).toMatchObject({ code: 'CONFLICT' })
    expect(tx.contact.delete).not.toHaveBeenCalled()
  })
})

describe('mergeTimelinePage', () => {
  function activityItem(id: string, at: string): TimelineItem {
    return { kind: 'activity', id, at, type: 'NOTE', body: null, meta: null, actor: null }
  }

  it('interleaves items by `at` descending', () => {
    const items = [
      activityItem('c1', '2026-01-01T00:00:00.000Z'),
      activityItem('c2', '2026-01-03T00:00:00.000Z'),
      activityItem('c3', '2026-01-02T00:00:00.000Z'),
    ]

    const page = mergeTimelinePage(items, 10)

    expect(page.items.map((i) => i.id)).toEqual(['c2', 'c3', 'c1'])
    expect(page.nextCursor).toBeNull()
  })

  it('respects the limit and sets nextCursor to the boundary `at`', () => {
    const items = [
      activityItem('c1', '2026-01-01T00:00:00.000Z'),
      activityItem('c2', '2026-01-02T00:00:00.000Z'),
      activityItem('c3', '2026-01-03T00:00:00.000Z'),
    ]

    const page = mergeTimelinePage(items, 2)

    expect(page.items.map((i) => i.id)).toEqual(['c3', 'c2'])
    expect(page.nextCursor).toBe('2026-01-02T00:00:00.000Z')
  })

  it('extends the page to include every item tied on the boundary `at`', () => {
    const items = [
      activityItem('c1', '2026-01-01T00:00:00.000Z'),
      activityItem('c2', '2026-01-02T00:00:00.000Z'),
      activityItem('c3', '2026-01-02T00:00:00.000Z'),
      activityItem('c4', '2026-01-03T00:00:00.000Z'),
    ]

    const page = mergeTimelinePage(items, 2)

    expect(page.items.map((i) => i.id).sort()).toEqual(['c2', 'c3', 'c4'])
    expect(page.nextCursor).toBe('2026-01-02T00:00:00.000Z')
  })
})

// S13 finding 4: repository.findTimelinePage re-fetches a source's rows at
// the exact boundary timestamp when that source's own limit+1 window was
// fully saturated there, so a tie at the page boundary is never silently
// dropped by the next page's strict `before < T` filter. mergeTimelinePage
// itself (the pure merge/tie-extend step) is already covered above; these
// tests cover the extra per-source re-fetch findTimelinePage adds around it.
describe('findTimelinePage (tie-loss at the page boundary)', () => {
  const boundary = '2026-01-02T00:00:00.000Z'
  const newer = '2026-01-03T00:00:00.000Z'

  function activityRow(id: string, at: string) {
    return { id, type: 'NOTE' as const, body: null, meta: null, createdAt: new Date(at), actor: null }
  }

  function messageRow(id: string, at: string) {
    return {
      id,
      channel: 'LINE' as const,
      direction: 'OUTBOUND' as const,
      status: 'SENT' as const,
      body: 'hi',
      attemptCount: 1,
      lastError: null,
      aiSuggestionId: null,
      createdAt: new Date(at),
    }
  }

  it('re-fetches and includes every same-timestamp row a saturated source could not fit in its own window', async () => {
    const client = {
      activity: { findMany: vi.fn() },
      message: { findMany: vi.fn() },
    }

    // First pass: take = limit + 1 = 3. The activity table actually has 4
    // rows tied on `boundary`, but this fetch (ordered desc, capped at 3)
    // only captures 3 rows total, 2 of which are at the boundary.
    client.activity.findMany.mockResolvedValueOnce([
      activityRow('a1', newer),
      activityRow('a2', boundary),
      activityRow('a3', boundary),
    ])
    client.message.findMany.mockResolvedValueOnce([])

    // Second pass: the extra fetch at exactly the boundary timestamp, which
    // returns the real full set of tied rows, including a4 (missed above).
    client.activity.findMany.mockResolvedValueOnce([
      activityRow('a2', boundary),
      activityRow('a3', boundary),
      activityRow('a4', boundary),
    ])

    const page = await findTimelinePage(client as unknown as Tx, leadId, { limit: 2 })

    expect(client.activity.findMany).toHaveBeenCalledTimes(2)
    expect(client.message.findMany).toHaveBeenCalledTimes(1)
    expect(page.nextCursor).toBe(boundary)
    const ids = page.items.map((item) => item.id)
    expect(ids.sort()).toEqual(['a1', 'a2', 'a3', 'a4'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  // S15 round 2: asserts the exact re-fetch `where` and `take` args, so a
  // regression that swapped the exact-equals `createdAt: lastAt` for an
  // `lte` (which would also re-include rows already captured, or drift the
  // cap) would fail this test even though the previous test's id-set
  // assertion alone would not catch an `lte` regression.
  it('re-fetches the saturated source with an exact-equals createdAt and the 500-row cap, not lte', async () => {
    const client = {
      activity: { findMany: vi.fn() },
      message: { findMany: vi.fn() },
    }

    client.activity.findMany.mockResolvedValueOnce([
      activityRow('a1', newer),
      activityRow('a2', boundary),
      activityRow('a3', boundary),
    ])
    client.message.findMany.mockResolvedValueOnce([])
    client.activity.findMany.mockResolvedValueOnce([
      activityRow('a2', boundary),
      activityRow('a3', boundary),
      activityRow('a4', boundary),
    ])

    await findTimelinePage(client as unknown as Tx, leadId, { limit: 2 })

    expect(client.activity.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { leadId, createdAt: new Date(boundary) },
        orderBy: [{ id: 'desc' }],
        take: 500,
      }),
    )
  })

  // Mirrors the activity-source test above, but for the MESSAGE source: the
  // message table (not the activity table) is the one saturated at
  // `limit + 1` with its own last row landing exactly on the boundary, so
  // the message re-fetch (repository.ts findTimelinePage, the MESSAGE-source
  // branch around :362-371) must fire with the exact `where`, `take` cap and
  // `orderBy` the ACTIVITY branch already asserts.
  it('re-fetches the saturated MESSAGE source with an exact-equals createdAt and the 500-row cap', async () => {
    const client = {
      activity: { findMany: vi.fn() },
      message: { findMany: vi.fn() },
    }

    // First pass: take = limit + 1 = 3. The message table actually has 4
    // rows tied on `boundary`, but this fetch (ordered desc, capped at 3)
    // only captures 3 rows total, 2 of which are at the boundary.
    client.activity.findMany.mockResolvedValueOnce([])
    client.message.findMany.mockResolvedValueOnce([
      messageRow('m1', newer),
      messageRow('m2', boundary),
      messageRow('m3', boundary),
    ])

    // Second pass: the extra fetch at exactly the boundary timestamp, which
    // returns the real full set of tied rows, including m4 (missed above).
    client.message.findMany.mockResolvedValueOnce([
      messageRow('m2', boundary),
      messageRow('m3', boundary),
      messageRow('m4', boundary),
    ])

    const page = await findTimelinePage(client as unknown as Tx, leadId, { limit: 2 })

    expect(client.activity.findMany).toHaveBeenCalledTimes(1)
    expect(client.message.findMany).toHaveBeenCalledTimes(2)
    expect(client.message.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { leadId, createdAt: new Date(boundary) },
        orderBy: [{ id: 'desc' }],
        take: 500,
      }),
    )
    expect(page.nextCursor).toBe(boundary)
    const ids = page.items.map((item) => item.id)
    expect(ids.sort()).toEqual(['m1', 'm2', 'm3', 'm4'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('does not re-fetch when no source is saturated exactly at the boundary', async () => {
    const client = {
      activity: { findMany: vi.fn().mockResolvedValueOnce([activityRow('a1', newer)]) },
      message: { findMany: vi.fn().mockResolvedValueOnce([]) },
    }

    const page = await findTimelinePage(client as unknown as Tx, leadId, { limit: 2 })

    expect(client.activity.findMany).toHaveBeenCalledTimes(1)
    expect(client.message.findMany).toHaveBeenCalledTimes(1)
    expect(page.nextCursor).toBeNull()
    expect(page.items.map((item) => item.id)).toEqual(['a1'])
  })
})

describe('buildLeadWhere', () => {
  it('combines the open filter with a case-insensitive search across title and contact fields', () => {
    const where = buildLeadWhere({
      page: 1,
      pageSize: 25,
      sort: 'updatedAt',
      dir: 'desc',
      open: 'true',
      q: 'x',
    })

    expect(where).toEqual({
      AND: [
        { stage: { notIn: ['WON', 'LOST'] } },
        {
          OR: [
            { title: { contains: 'x', mode: 'insensitive' } },
            { contact: { is: { firstName: { contains: 'x', mode: 'insensitive' } } } },
            { contact: { is: { lastName: { contains: 'x', mode: 'insensitive' } } } },
            { contact: { is: { email: { contains: 'x', mode: 'insensitive' } } } },
            { company: { is: { name: { contains: 'x', mode: 'insensitive' } } } },
          ],
        },
      ],
    })
  })
})

describe('parseIdOrNotFound', () => {
  it('throws NOT_FOUND for a non-cuid id', () => {
    let error: unknown
    try {
      parseIdOrNotFound('bad', 'lead')
    } catch (err) {
      error = err
    }

    expect(error).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('returns the id unchanged when it is a valid cuid', () => {
    expect(parseIdOrNotFound(leadId, 'lead')).toBe(leadId)
  })
})
