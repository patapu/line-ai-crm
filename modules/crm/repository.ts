import 'server-only'
import { z } from 'zod'
import { Prisma, type LeadSource } from '@/lib/generated/prisma/client'
import type { Tx } from '@/lib/db'
import { DomainError } from '@/lib/errors'
import { PageQuery, type Paged } from '@/lib/contracts/common'
import type { ContactListQuery, LeadListQuery } from '@/lib/contracts/crm'
import type { TimelineItem, TimelinePage } from '@/lib/contracts/timeline'
import type { LeadDetail, LeadListItem } from '@/modules/crm/types'

// [A] modules/crm/repository.ts: Prisma queries, DTO mappers and pure query
// helpers for the crm module. service.ts owns orchestration (auth checks,
// transactions, writeActivity); this file never imports lib/auth/dal.ts or
// modules/audit, and never throws anything but DomainError('VALIDATION_FAILED', ...)
// for the assertion helpers below. See docs/design.md section 4.

export type UserOption = { id: string; name: string; role: 'ADMIN' | 'SALES' }
export type CompanyOption = { id: string; name: string }

export interface ContactListItem {
  id: string
  firstName: string
  lastName: string | null
  email: string | null
  phone: string | null
  hasLine: boolean
  lineDisplayName: string | null
  source: LeadSource
  company: { id: string; name: string } | null
  owner: { id: string; name: string } | null
  leadCount: number
  updatedAt: string
}

export interface ContactDetail extends ContactListItem {
  companyId: string | null
  ownerId: string | null
  createdAt: string
  tagIds: string[]
}

export interface CompanyListItem {
  id: string
  name: string
  domain: string | null
  industry: string | null
  sizeBand: string | null
  contactCount: number
  leadCount: number
  updatedAt: string
}

export interface CompanyDetail extends CompanyListItem {
  createdAt: string
  createdBy: { id: string; name: string } | null
}

export const CompanyListQuery = PageQuery.extend({
  q: z.string().trim().max(100).optional(),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a `URLSearchParams` or a Next.js `searchParams` record into a
 * flat `Record<string, string>` suitable for `Schema.parse(...)`: the first
 * value wins for a repeated key or an array value, and empty strings /
 * `undefined` are dropped so zod's `.optional()` defaults apply.
 */
export function queryObject(
  input: URLSearchParams | Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (input instanceof URLSearchParams) {
    for (const [key, value] of input.entries()) {
      if (out[key] === undefined && value !== '') out[key] = value
    }
    return out
  }
  for (const [key, raw] of Object.entries(input)) {
    const value = Array.isArray(raw) ? raw[0] : raw
    if (value !== undefined && value !== '') out[key] = value
  }
  return out
}

export function isPrismaError(err: unknown, code: 'P2002' | 'P2003' | 'P2025'): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

const leadListSelect = {
  id: true,
  title: true,
  stage: true,
  source: true,
  value: true,
  currency: true,
  score: true,
  stageChangedAt: true,
  updatedAt: true,
  contact: { select: { id: true, firstName: true, lastName: true } },
  company: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
} satisfies Prisma.LeadSelect

const leadDetailSelect = {
  ...leadListSelect,
  createdAt: true,
  closedAt: true,
  lostReason: true,
  scoreUpdatedAt: true,
  ownerId: true,
  createdBy: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true, lineUserId: true, lineDisplayName: true } },
} satisfies Prisma.LeadSelect

type LeadListRow = Prisma.LeadGetPayload<{ select: typeof leadListSelect }>
type LeadDetailRow = Prisma.LeadGetPayload<{ select: typeof leadDetailSelect }>

export function toLeadListItem(row: LeadListRow): LeadListItem {
  return {
    id: row.id,
    title: row.title,
    stage: row.stage,
    source: row.source,
    value: row.value === null ? null : row.value.toNumber(),
    currency: row.currency,
    score: row.score,
    stageChangedAt: row.stageChangedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    contact: { id: row.contact.id, firstName: row.contact.firstName, lastName: row.contact.lastName },
    company: row.company ? { id: row.company.id, name: row.company.name } : null,
    owner: { id: row.owner.id, name: row.owner.name },
  }
}

export function toLeadDetail(row: LeadDetailRow): LeadDetail {
  return {
    ...toLeadListItem(row),
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    lostReason: row.lostReason,
    scoreUpdatedAt: row.scoreUpdatedAt ? row.scoreUpdatedAt.toISOString() : null,
    createdBy: row.createdBy ? { id: row.createdBy.id, name: row.createdBy.name } : null,
    ownerId: row.ownerId,
    contact: {
      id: row.contact.id,
      firstName: row.contact.firstName,
      lastName: row.contact.lastName,
      hasLine: row.contact.lineUserId !== null,
      lineDisplayName: row.contact.lineDisplayName,
    },
  }
}

export function buildLeadWhere(q: z.infer<typeof LeadListQuery>): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = []
  if (q.stage) and.push({ stage: q.stage })
  if (q.ownerId) and.push({ ownerId: q.ownerId })
  if (q.source) and.push({ source: q.source })
  if (q.companyId) and.push({ companyId: q.companyId })
  if (q.open === 'true') and.push({ stage: { notIn: ['WON', 'LOST'] } })
  if (q.open === 'false') and.push({ stage: { in: ['WON', 'LOST'] } })
  if (q.q) {
    const c = { contains: q.q, mode: 'insensitive' as const }
    and.push({
      OR: [
        { title: c },
        { contact: { is: { firstName: c } } },
        { contact: { is: { lastName: c } } },
        { contact: { is: { email: c } } },
        { company: { is: { name: c } } },
      ],
    })
  }
  return and.length ? { AND: and } : {}
}

export function buildLeadOrderBy(
  sort: z.infer<typeof LeadListQuery>['sort'],
  dir: z.infer<typeof LeadListQuery>['dir'],
): Prisma.LeadOrderByWithRelationInput[] {
  switch (sort) {
    case 'value':
      return [{ value: { sort: dir, nulls: 'last' } }, { id: dir }]
    case 'createdAt':
      return [{ createdAt: dir }, { id: dir }]
    case 'stageChangedAt':
      return [{ stageChangedAt: dir }, { id: dir }]
    default:
      return [{ updatedAt: dir }, { id: dir }]
  }
}

export async function findLeadsPage(client: Tx, q: z.infer<typeof LeadListQuery>): Promise<Paged<LeadListItem>> {
  const where = buildLeadWhere(q)
  const orderBy = buildLeadOrderBy(q.sort, q.dir)
  const [total, rows] = await Promise.all([
    client.lead.count({ where }),
    client.lead.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: leadListSelect,
    }),
  ])
  return { items: rows.map(toLeadListItem), page: q.page, pageSize: q.pageSize, total }
}

export async function findLeadDetail(client: Tx, id: string): Promise<LeadDetail | null> {
  const row = await client.lead.findUnique({ where: { id }, select: leadDetailSelect })
  return row ? toLeadDetail(row) : null
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

const activityTimelineSelect = {
  id: true,
  type: true,
  body: true,
  meta: true,
  createdAt: true,
  actor: { select: { id: true, name: true } },
} satisfies Prisma.ActivitySelect

const messageTimelineSelect = {
  id: true,
  channel: true,
  direction: true,
  status: true,
  body: true,
  attemptCount: true,
  lastError: true,
  aiSuggestionId: true,
  createdAt: true,
} satisfies Prisma.MessageSelect

type ActivityTimelineRow = Prisma.ActivityGetPayload<{ select: typeof activityTimelineSelect }>
type MessageTimelineRow = Prisma.MessageGetPayload<{ select: typeof messageTimelineSelect }>

export function activityToItem(row: ActivityTimelineRow): TimelineItem {
  return {
    kind: 'activity',
    id: row.id,
    at: row.createdAt.toISOString(),
    type: row.type,
    body: row.body,
    meta: row.meta,
    actor: row.actor,
  }
}

export function messageToItem(row: MessageTimelineRow): TimelineItem {
  return {
    kind: 'message',
    id: row.id,
    at: row.createdAt.toISOString(),
    channel: row.channel,
    direction: row.direction,
    status: row.status,
    body: row.body,
    attemptCount: row.attemptCount,
    lastError: row.lastError,
    aiSuggestionId: row.aiSuggestionId,
  }
}

/**
 * Merges Activity and Message rows into one cursor page, newest first. Pure
 * and exported for tests: `sorted.length <= limit` means BOTH sources
 * returned fewer than `limit + 1` rows, i.e. every source is exhausted, so
 * `nextCursor` is null. Otherwise the page is extended past `limit` to
 * include every item that ties on `at` with the boundary item, because the
 * next page's `before` filter is a strict `<` and would otherwise drop
 * same-timestamp siblings.
 */
export function mergeTimelinePage(items: TimelineItem[], limit: number): TimelinePage {
  const sorted = [...items].sort((a, b) =>
    a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0,
  )
  if (sorted.length <= limit) return { items: sorted, nextCursor: null }
  const page = sorted.slice(0, limit)
  const lastAt = page[page.length - 1].at
  for (let i = limit; i < sorted.length && sorted[i].at === lastAt; i++) page.push(sorted[i])
  return { items: page, nextCursor: lastAt }
}

/**
 * Fetches `limit + 1` rows from each source, merges them with
 * `mergeTimelinePage`, then closes a tie-loss gap: if a source's page came
 * back exactly `limit + 1` rows deep (i.e. it may have more rows this deep
 * that we did not fetch) AND its own last fetched row lands exactly on the
 * merged page's boundary timestamp, that source could have additional
 * same-timestamp rows beyond what we took. In that case, re-fetch that
 * source's rows at exactly that timestamp (capped at TIE_REFETCH_CAP as a
 * safety bound), merge it in (deduped by `kind:id`), and re-run
 * `mergeTimelinePage`, so the next page's strict `before < T` filter never
 * silently drops a same-timestamp sibling.
 */
export async function findTimelinePage(
  client: Tx,
  leadId: string,
  q: { before?: string; limit: number },
): Promise<TimelinePage> {
  const where = { leadId, ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}) }
  const take = q.limit + 1
  const [acts, msgs] = await Promise.all([
    client.activity.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: activityTimelineSelect,
    }),
    client.message.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: messageTimelineSelect,
    }),
  ])

  const items: TimelineItem[] = [...acts.map(activityToItem), ...msgs.map(messageToItem)]
  let page = mergeTimelinePage(items, q.limit)
  if (!page.nextCursor) return page

  const lastAt = new Date(page.nextCursor)
  const extraQueries: Promise<TimelineItem[]>[] = []

  // Cap: this re-fetch pulls every row a source has at exactly `lastAt`,
  // which is normally a handful of ties but is otherwise unbounded (a
  // pathological burst of same-millisecond rows could otherwise pull an
  // arbitrarily large result set). 500 is far beyond any realistic tie
  // count for this app's traffic, so it is effectively just a safety cap.
  const TIE_REFETCH_CAP = 500

  const lastAct = acts[acts.length - 1]
  if (acts.length === take && lastAct.createdAt.getTime() === lastAt.getTime()) {
    extraQueries.push(
      client.activity
        .findMany({ where: { leadId, createdAt: lastAt }, take: TIE_REFETCH_CAP, select: activityTimelineSelect })
        .then((rows) => rows.map(activityToItem)),
    )
  }

  const lastMsg = msgs[msgs.length - 1]
  if (msgs.length === take && lastMsg.createdAt.getTime() === lastAt.getTime()) {
    extraQueries.push(
      client.message
        .findMany({ where: { leadId, createdAt: lastAt }, take: TIE_REFETCH_CAP, select: messageTimelineSelect })
        .then((rows) => rows.map(messageToItem)),
    )
  }

  if (extraQueries.length === 0) return page

  const extras = (await Promise.all(extraQueries)).flat()
  const seen = new Set(items.map((item) => `${item.kind}:${item.id}`))
  for (const extra of extras) {
    const dedupeKey = `${extra.kind}:${extra.id}`
    if (!seen.has(dedupeKey)) {
      items.push(extra)
      seen.add(dedupeKey)
    }
  }

  page = mergeTimelinePage(items, q.limit)
  return page
}

// ---------------------------------------------------------------------------
// Assertions — throw VALIDATION_FAILED with a fieldErrors entry
// ---------------------------------------------------------------------------

export async function assertActiveUser(client: Tx, userId: string, field: string): Promise<void> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { active: true } })
  if (!user || !user.active) {
    throw new DomainError('VALIDATION_FAILED', 'user not found or inactive', {
      [field]: ['user not found or inactive'],
    })
  }
}

export async function assertContactExists(client: Tx, id: string): Promise<void> {
  const contact = await client.contact.findUnique({ where: { id }, select: { id: true } })
  if (!contact) {
    throw new DomainError('VALIDATION_FAILED', 'contact not found', { contactId: ['contact not found'] })
  }
}

export async function assertCompanyExists(client: Tx, id: string): Promise<void> {
  const company = await client.company.findUnique({ where: { id }, select: { id: true } })
  if (!company) {
    throw new DomainError('VALIDATION_FAILED', 'company not found', { companyId: ['company not found'] })
  }
}

export async function assertTagsExist(client: Tx, ids: string[]): Promise<void> {
  const count = await client.tag.count({ where: { id: { in: ids } } })
  if (count !== new Set(ids).size) {
    throw new DomainError('VALIDATION_FAILED', 'one or more tags not found', {
      tagIds: ['one or more tags not found'],
    })
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export async function findActiveUsers(client: Tx): Promise<UserOption[]> {
  return client.user.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, role: true },
  })
}

export async function findCompanyOptions(client: Tx): Promise<CompanyOption[]> {
  return client.company.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const contactSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  lineUserId: true,
  lineDisplayName: true,
  source: true,
  companyId: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
  company: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
  tags: { select: { id: true } },
  _count: { select: { leads: true } },
} satisfies Prisma.ContactSelect

type ContactRow = Prisma.ContactGetPayload<{ select: typeof contactSelect }>

function toContactListItem(row: ContactRow): ContactListItem {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    hasLine: row.lineUserId !== null,
    lineDisplayName: row.lineDisplayName,
    source: row.source,
    company: row.company,
    owner: row.owner,
    leadCount: row._count.leads,
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toContactDetail(row: ContactRow): ContactDetail {
  return {
    ...toContactListItem(row),
    companyId: row.companyId,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
    tagIds: row.tags.map((tag) => tag.id),
  }
}

export function buildContactWhere(q: z.infer<typeof ContactListQuery>): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = []
  if (q.q) {
    const c = { contains: q.q, mode: 'insensitive' as const }
    and.push({ OR: [{ firstName: c }, { lastName: c }, { email: c }, { phone: c }, { lineDisplayName: c }] })
  }
  if (q.companyId) and.push({ companyId: q.companyId })
  if (q.hasLine === 'true') and.push({ lineUserId: { not: null } })
  if (q.hasLine === 'false') and.push({ lineUserId: null })
  if (q.tagId) and.push({ tags: { some: { id: q.tagId } } })
  return and.length ? { AND: and } : {}
}

export async function findContactsPage(
  client: Tx,
  q: z.infer<typeof ContactListQuery>,
): Promise<Paged<ContactListItem>> {
  const where = buildContactWhere(q)
  const [total, rows] = await Promise.all([
    client.contact.count({ where }),
    client.contact.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: contactSelect,
    }),
  ])
  return { items: rows.map(toContactListItem), page: q.page, pageSize: q.pageSize, total }
}

export async function findContactDetail(client: Tx, id: string): Promise<ContactDetail | null> {
  const row = await client.contact.findUnique({ where: { id }, select: contactSelect })
  return row ? toContactDetail(row) : null
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

const companySelect = {
  id: true,
  name: true,
  domain: true,
  industry: true,
  sizeBand: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
  _count: { select: { contacts: true, leads: true } },
} satisfies Prisma.CompanySelect

type CompanyRow = Prisma.CompanyGetPayload<{ select: typeof companySelect }>

function toCompanyListItem(row: CompanyRow): CompanyListItem {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    industry: row.industry,
    sizeBand: row.sizeBand,
    contactCount: row._count.contacts,
    leadCount: row._count.leads,
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toCompanyDetail(row: CompanyRow): CompanyDetail {
  return {
    ...toCompanyListItem(row),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  }
}

export function buildCompanyWhere(q: z.infer<typeof CompanyListQuery>): Prisma.CompanyWhereInput {
  if (!q.q) return {}
  const c = { contains: q.q, mode: 'insensitive' as const }
  return { OR: [{ name: c }, { domain: c }] }
}

export async function findCompaniesPage(
  client: Tx,
  q: z.infer<typeof CompanyListQuery>,
): Promise<Paged<CompanyListItem>> {
  const where = buildCompanyWhere(q)
  const [total, rows] = await Promise.all([
    client.company.count({ where }),
    client.company.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: companySelect,
    }),
  ])
  return { items: rows.map(toCompanyListItem), page: q.page, pageSize: q.pageSize, total }
}

export async function findCompanyDetail(client: Tx, id: string): Promise<CompanyDetail | null> {
  const row = await client.company.findUnique({ where: { id }, select: companySelect })
  return row ? toCompanyDetail(row) : null
}
