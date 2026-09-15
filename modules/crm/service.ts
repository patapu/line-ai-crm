// [signatures F, bodies A] modules/crm/service.ts: see docs/design.md
// section 4 and section 5B step 2 (changeStage transaction shape).
// Lane A fills in the bodies; layer 0 only freezes the signatures.

import type { z } from 'zod'
import type { Activity, Contact, Lead, LeadSource, LeadStage, Prisma } from '@/lib/generated/prisma/client'
import { getDb, type Db, type Tx } from '@/lib/db'
import { canActOnLead, type Actor } from '@/lib/auth/dal'
import { DomainError } from '@/lib/errors'
import { log } from '@/lib/log'
import { IdSchema, type Paged } from '@/lib/contracts/common'
import type {
  ActivityCreate,
  CompanyCreate,
  CompanyUpdate,
  ContactCreate,
  ContactListQuery,
  ContactUpdate,
  LeadCreate,
  LeadListQuery,
  LeadUpdate,
} from '@/lib/contracts/crm'
import type { TimelinePage, TimelineQuery } from '@/lib/contracts/timeline'
import type { LeadDetail, LeadListItem } from '@/modules/crm/types'
import { writeActivity } from '@/modules/audit'
import * as repo from '@/modules/crm/repository'
import type {
  CompanyDetail,
  CompanyListItem,
  CompanyListQuery,
  CompanyOption,
  ContactDetail,
  ContactListItem,
  UserOption,
} from '@/modules/crm/repository'

/**
 * One $transaction: read lead -> same stage => {changed:false}, no Activity
 * -> canActOnLead else FORBIDDEN -> updateMany where {id, stage: from}
 * (count 0 => CONFLICT) -> set stageChangedAt, closedAt (WON/LOST) or null,
 * lostReason -> writeActivity STAGE_CHANGED {from,to,reason}
 */
export async function changeStage(
  input: { leadId: string; to: LeadStage; reason?: string; actor: Actor },
  db?: Db,
): Promise<{ lead: Lead; changed: boolean }> {
  const client = db ?? getDb()

  const result = await client.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: input.leadId } })
    if (!lead) throw new DomainError('NOT_FOUND', 'lead not found')

    if (lead.stage === input.to) return { lead, changed: false, from: lead.stage }

    if (!canActOnLead(input.actor, lead)) {
      throw new DomainError('FORBIDDEN', 'only the lead owner or an admin can change the stage')
    }

    if (input.to === 'LOST' && !input.reason?.trim()) {
      throw new DomainError('VALIDATION_FAILED', 'reason required for LOST', {
        reason: ['reason required for LOST'],
      })
    }

    const now = new Date()
    const closed = input.to === 'WON' || input.to === 'LOST'
    const { count } = await tx.lead.updateMany({
      where: { id: lead.id, stage: lead.stage },
      data: {
        stage: input.to,
        stageChangedAt: now,
        closedAt: closed ? now : null,
        lostReason: input.to === 'LOST' ? (input.reason?.trim() ?? '') : null,
      },
    })
    if (count === 0) {
      throw new DomainError('CONFLICT', 'lead stage changed concurrently, reload and retry')
    }

    await writeActivity(tx, {
      leadId: lead.id,
      type: 'STAGE_CHANGED',
      meta: { from: lead.stage, to: input.to, reason: input.reason?.trim() ?? null },
      actor: input.actor,
    })

    return { lead: await tx.lead.findUniqueOrThrow({ where: { id: lead.id } }), changed: true, from: lead.stage }
  })

  // Logged after the transaction commits, not from inside the $transaction
  // callback: a rollback (e.g. the CONFLICT branch above) must never produce
  // a stage_changed log line for a change that did not happen. `from` comes
  // back from the transaction's own return value (not a closure variable
  // narrowed to `never` by TypeScript across the async boundary).
  if (result.changed) {
    log('info', 'crm.stage_changed', {
      leadId: input.leadId,
      from: result.from,
      to: input.to,
      userId: input.actor.kind === 'user' ? input.actor.id : null,
    })
  }

  return { lead: result.lead, changed: result.changed }
}

export async function createLead(input: z.infer<typeof LeadCreate>, actor: Actor, db?: Db): Promise<Lead> {
  const client = db ?? getDb()
  // lib/contracts/crm.ts allows up to 1e10, but Lead.value is Decimal(12,2),
  // whose max is 9,999,999,999.99: see docs/contract-change-requests.md
  // CR-1. Guard here until that contract is fixed. Compare the value
  // rounded to cents (not the raw float) against 1e12 cents: a value like
  // 9_999_999_999.999 is itself just under 1e10, but rounds to
  // 10000000000.00 once stored in a Decimal(12,2) column, which overflows.
  if (input.value !== undefined && input.value !== null && Math.round(input.value * 100) >= 1e12) {
    throw new DomainError('VALIDATION_FAILED', 'value too large', {
      value: ['must be less than 10,000,000,000'],
    })
  }
  const ownerId = input.ownerId ?? (actor.kind === 'user' ? actor.id : undefined)
  if (!ownerId) {
    throw new DomainError('VALIDATION_FAILED', 'ownerId is required', { ownerId: ['ownerId is required'] })
  }
  if (actor.kind === 'user' && actor.role !== 'ADMIN' && ownerId !== actor.id) {
    throw new DomainError('FORBIDDEN', 'only an admin can create a lead for another owner')
  }

  return client.$transaction(async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { id: input.contactId },
      select: { id: true, companyId: true },
    })
    if (!contact) {
      throw new DomainError('VALIDATION_FAILED', 'contact not found', { contactId: ['contact not found'] })
    }

    await repo.assertActiveUser(tx, ownerId, 'ownerId')
    if (input.companyId) {
      await repo.assertCompanyExists(tx, input.companyId)
    }

    const lead = await tx.lead.create({
      data: {
        title: input.title,
        contactId: input.contactId,
        companyId: input.companyId === undefined ? contact.companyId : input.companyId,
        ownerId,
        source: input.source,
        value: input.value ?? null,
        createdById: actor.kind === 'user' ? actor.id : null,
      },
    })

    await writeActivity(tx, { leadId: lead.id, type: 'LEAD_CREATED', meta: { source: lead.source, ownerId }, actor })

    return lead
  })
}

export async function listLeads(q: z.infer<typeof LeadListQuery>, db?: Db): Promise<Paged<LeadListItem>> {
  return repo.findLeadsPage(db ?? getDb(), q)
}

export async function getLeadDetail(id: string, db?: Db): Promise<LeadDetail | null> {
  return repo.findLeadDetail(db ?? getDb(), id)
}

export async function getLeadTimeline(
  leadId: string,
  q: z.infer<typeof TimelineQuery>,
  db?: Db,
): Promise<TimelinePage> {
  const client = db ?? getDb()
  const lead = await client.lead.findUnique({ where: { id: leadId }, select: { id: true } })
  if (!lead) throw new DomainError('NOT_FOUND', 'lead not found')
  return repo.findTimelinePage(client, leadId, q)
}

export async function findOrCreateContactByLineUserId(
  tx: Tx,
  input: { lineUserId: string; displayName?: string | null },
): Promise<{ contact: Contact; created: boolean }> {
  const existing = await tx.contact.findUnique({ where: { lineUserId: input.lineUserId } })
  if (existing) {
    const name = input.displayName?.trim()
    if (name && name !== existing.lineDisplayName) {
      const updated = await tx.contact.update({ where: { id: existing.id }, data: { lineDisplayName: name } })
      return { contact: updated, created: false }
    }
    return { contact: existing, created: false }
  }

  const name = input.displayName?.trim() || null
  const { count } = await tx.contact.createMany({
    data: [{ firstName: name ?? 'LINE user', lineUserId: input.lineUserId, lineDisplayName: name, source: 'LINE' }],
    skipDuplicates: true,
  })
  const contact = await tx.contact.findUniqueOrThrow({ where: { lineUserId: input.lineUserId } })
  return { contact, created: count === 1 }
}

/** latest non WON/LOST, else NEW */
export async function findOrOpenLeadForContact(
  tx: Tx,
  input: { contactId: string; ownerId: string; source: LeadSource; actor: Actor },
): Promise<{ lead: Lead; created: boolean }> {
  const existing = await tx.lead.findFirst({
    where: { contactId: input.contactId, stage: { notIn: ['WON', 'LOST'] } },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  })
  if (existing) return { lead: existing, created: false }

  const contact = await tx.contact.findUnique({
    where: { id: input.contactId },
    select: { firstName: true, lineDisplayName: true, companyId: true },
  })
  if (!contact) throw new DomainError('NOT_FOUND', 'contact not found')

  const lead = await tx.lead.create({
    data: {
      title: ('LINE: ' + (contact.lineDisplayName ?? contact.firstName)).slice(0, 200),
      contactId: input.contactId,
      companyId: contact.companyId,
      ownerId: input.ownerId,
      source: input.source,
      stage: 'NEW',
      createdById: input.actor.kind === 'user' ? input.actor.id : null,
    },
  })

  await writeActivity(tx, {
    leadId: lead.id,
    type: 'LEAD_CREATED',
    meta: { source: input.source, via: 'line' },
    actor: input.actor,
  })

  return { lead, created: true }
}

// ---------------------------------------------------------------------------
// New exports (Lane A) — see docs/design.md section 3's API table. These are
// additive: the 7 signatures above are the only ones layer 0 froze.
// ---------------------------------------------------------------------------

export function parseIdOrNotFound(id: string, entity: 'lead' | 'contact' | 'company'): string {
  if (!IdSchema.safeParse(id).success) {
    throw new DomainError('NOT_FOUND', `${entity} not found`)
  }
  return id
}

export async function updateLead(id: string, input: z.infer<typeof LeadUpdate>, actor: Actor, db?: Db): Promise<Lead> {
  const client = db ?? getDb()
  // See the matching guard (and its rationale) in createLead above and
  // CR-1 in docs/contract-change-requests.md.
  if (input.value !== undefined && input.value !== null && Math.round(input.value * 100) >= 1e12) {
    throw new DomainError('VALIDATION_FAILED', 'value too large', {
      value: ['must be less than 10,000,000,000'],
    })
  }
  return client.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id } })
    if (!lead) throw new DomainError('NOT_FOUND', 'lead not found')

    if (!canActOnLead(actor, lead)) {
      throw new DomainError('FORBIDDEN', 'only the lead owner or an admin can edit this lead')
    }

    const ownerChanging = input.ownerId !== undefined && input.ownerId !== lead.ownerId
    if (ownerChanging && actor.kind === 'user' && actor.role !== 'ADMIN') {
      throw new DomainError('FORBIDDEN', 'only an admin can reassign the owner')
    }
    if (ownerChanging && input.ownerId) {
      await repo.assertActiveUser(tx, input.ownerId, 'ownerId')
    }

    if (input.contactId !== undefined && input.contactId !== lead.contactId) {
      await repo.assertContactExists(tx, input.contactId)
    }
    if (input.companyId) {
      await repo.assertCompanyExists(tx, input.companyId)
    }

    const data: Prisma.LeadUncheckedUpdateInput = {}
    if (input.title !== undefined) data.title = input.title
    if (input.contactId !== undefined) data.contactId = input.contactId
    if (input.companyId !== undefined) data.companyId = input.companyId
    if (input.value !== undefined) data.value = input.value
    if (ownerChanging && input.ownerId) data.ownerId = input.ownerId

    if (Object.keys(data).length === 0) return lead

    const updated = await tx.lead.update({ where: { id: lead.id }, data })

    if (ownerChanging) {
      await writeActivity(tx, {
        leadId: lead.id,
        type: 'OWNER_CHANGED',
        meta: { from: lead.ownerId, to: input.ownerId ?? null },
        actor,
      })
    }

    return updated
  })
}

export async function createActivity(
  leadId: string,
  input: z.infer<typeof ActivityCreate>,
  actor: Actor,
  db?: Db,
): Promise<Activity> {
  const client = db ?? getDb()
  return client.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { id: true } })
    if (!lead) throw new DomainError('NOT_FOUND', 'lead not found')
    return writeActivity(tx, { leadId, type: input.type, body: input.body, actor })
  })
}

export async function listUsers(db?: Db): Promise<UserOption[]> {
  return repo.findActiveUsers(db ?? getDb())
}

export async function listCompanyOptions(db?: Db): Promise<CompanyOption[]> {
  return repo.findCompanyOptions(db ?? getDb())
}

export async function listContacts(q: z.infer<typeof ContactListQuery>, db?: Db): Promise<Paged<ContactListItem>> {
  return repo.findContactsPage(db ?? getDb(), q)
}

export async function getContact(id: string, db?: Db): Promise<ContactDetail | null> {
  return repo.findContactDetail(db ?? getDb(), id)
}

export async function createContact(
  input: z.infer<typeof ContactCreate>,
  actor: Actor,
  db?: Db,
): Promise<ContactDetail> {
  const client = db ?? getDb()
  const created = await client.$transaction(async (tx) => {
    if (input.companyId) await repo.assertCompanyExists(tx, input.companyId)

    const ownerId = input.ownerId === undefined ? (actor.kind === 'user' ? actor.id : null) : input.ownerId
    if (ownerId) await repo.assertActiveUser(tx, ownerId, 'ownerId')

    if (input.tagIds && input.tagIds.length > 0) await repo.assertTagsExist(tx, input.tagIds)

    return tx.contact.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        email: input.email?.toLowerCase() ?? null,
        phone: input.phone ?? null,
        companyId: input.companyId ?? null,
        ownerId,
        source: 'MANUAL',
        createdById: actor.kind === 'user' ? actor.id : null,
        ...(input.tagIds && input.tagIds.length > 0
          ? { tags: { connect: input.tagIds.map((tagId) => ({ id: tagId })) } }
          : {}),
      },
      select: { id: true },
    })
  })

  const detail = await repo.findContactDetail(client, created.id)
  if (!detail) throw new DomainError('INTERNAL', 'contact not found after create')
  return detail
}

export async function updateContact(
  id: string,
  input: z.infer<typeof ContactUpdate>,
  actor: Actor,
  db?: Db,
): Promise<ContactDetail> {
  void actor
  const client = db ?? getDb()

  await client.$transaction(async (tx) => {
    const existing = await tx.contact.findUnique({ where: { id }, select: { id: true } })
    if (!existing) throw new DomainError('NOT_FOUND', 'contact not found')

    if (input.companyId) await repo.assertCompanyExists(tx, input.companyId)
    if (input.ownerId) await repo.assertActiveUser(tx, input.ownerId, 'ownerId')
    if (input.tagIds) await repo.assertTagsExist(tx, input.tagIds)

    const data: Prisma.ContactUncheckedUpdateInput = {}
    if (input.firstName !== undefined) data.firstName = input.firstName
    if (input.lastName !== undefined) data.lastName = input.lastName
    if (input.email !== undefined) data.email = input.email?.toLowerCase() ?? null
    if (input.phone !== undefined) data.phone = input.phone
    if (input.companyId !== undefined) data.companyId = input.companyId
    if (input.ownerId !== undefined) data.ownerId = input.ownerId
    if (input.tagIds !== undefined) data.tags = { set: input.tagIds.map((tagId) => ({ id: tagId })) }

    if (Object.keys(data).length > 0) {
      await tx.contact.update({ where: { id }, data })
    }
  })

  const detail = await repo.findContactDetail(client, id)
  if (!detail) throw new DomainError('NOT_FOUND', 'contact not found')
  return detail
}

export async function deleteContact(id: string, actor: Actor, db?: Db): Promise<void> {
  const client = db ?? getDb()

  await client.$transaction(async (tx) => {
    const existing = await tx.contact.findUnique({ where: { id }, select: { id: true } })
    if (!existing) throw new DomainError('NOT_FOUND', 'contact not found')

    const leadCount = await tx.lead.count({ where: { contactId: id } })
    if (leadCount > 0) throw new DomainError('CONFLICT', 'contact still has leads')

    const messageCount = await tx.message.count({ where: { contactId: id } })
    if (messageCount > 0) throw new DomainError('CONFLICT', 'contact still has messages')

    try {
      await tx.contact.delete({ where: { id } })
    } catch (err) {
      if (repo.isPrismaError(err, 'P2003')) {
        throw new DomainError('CONFLICT', 'contact is still referenced', undefined, { cause: err })
      }
      throw err
    }
  })

  log('info', 'crm.contact.deleted', { contactId: id, userId: actor.kind === 'user' ? actor.id : null })
}

export async function listCompanies(q: z.infer<typeof CompanyListQuery>, db?: Db): Promise<Paged<CompanyListItem>> {
  return repo.findCompaniesPage(db ?? getDb(), q)
}

export async function getCompany(id: string, db?: Db): Promise<CompanyDetail | null> {
  return repo.findCompanyDetail(db ?? getDb(), id)
}

export async function createCompany(
  input: z.infer<typeof CompanyCreate>,
  actor: Actor,
  db?: Db,
): Promise<CompanyDetail> {
  const client = db ?? getDb()
  let created: { id: string }
  try {
    created = await client.company.create({
      data: {
        name: input.name,
        domain: input.domain?.toLowerCase() ?? null,
        industry: input.industry ?? null,
        sizeBand: input.sizeBand ?? null,
        createdById: actor.kind === 'user' ? actor.id : null,
      },
      select: { id: true },
    })
  } catch (err) {
    if (repo.isPrismaError(err, 'P2002')) {
      throw new DomainError(
        'CONFLICT',
        'domain already exists',
        { domain: ['domain already exists'] },
        { cause: err },
      )
    }
    throw err
  }

  const detail = await repo.findCompanyDetail(client, created.id)
  if (!detail) throw new DomainError('INTERNAL', 'company not found after create')
  return detail
}

export async function updateCompany(
  id: string,
  input: z.infer<typeof CompanyUpdate>,
  actor: Actor,
  db?: Db,
): Promise<CompanyDetail> {
  void actor
  const client = db ?? getDb()

  const data: Prisma.CompanyUncheckedUpdateInput = {}
  if (input.name !== undefined) data.name = input.name
  if (input.domain !== undefined) data.domain = input.domain?.toLowerCase() ?? null
  if (input.industry !== undefined) data.industry = input.industry
  if (input.sizeBand !== undefined) data.sizeBand = input.sizeBand

  if (Object.keys(data).length > 0) {
    try {
      await client.company.update({ where: { id }, data })
    } catch (err) {
      if (repo.isPrismaError(err, 'P2002')) {
        throw new DomainError(
          'CONFLICT',
          'domain already exists',
          { domain: ['domain already exists'] },
          { cause: err },
        )
      }
      if (repo.isPrismaError(err, 'P2025')) {
        throw new DomainError('NOT_FOUND', 'company not found', undefined, { cause: err })
      }
      throw err
    }
  }

  const detail = await repo.findCompanyDetail(client, id)
  if (!detail) throw new DomainError('NOT_FOUND', 'company not found')
  return detail
}

export async function deleteCompany(id: string, actor: Actor, db?: Db): Promise<void> {
  const client = db ?? getDb()

  await client.$transaction(async (tx) => {
    const existing = await tx.company.findUnique({ where: { id }, select: { id: true } })
    if (!existing) throw new DomainError('NOT_FOUND', 'company not found')

    const [contactCount, leadCount] = await Promise.all([
      tx.contact.count({ where: { companyId: id } }),
      tx.lead.count({ where: { companyId: id } }),
    ])
    if (contactCount > 0 || leadCount > 0) {
      throw new DomainError('CONFLICT', 'company still has linked contacts or leads')
    }

    await tx.company.delete({ where: { id } })
  })

  log('info', 'crm.company.deleted', { companyId: id, userId: actor.kind === 'user' ? actor.id : null })
}
