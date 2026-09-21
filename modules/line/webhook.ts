// [C] modules/line/webhook.ts: see docs/design.md section 5A.
//
// Helpers for the inbound LINE webhook flow (app/api/line/webhook/route.ts
// and modules/line/service.ts's handleLineWebhook). Kept out of service.ts so
// the webhook-specific plumbing (the advisory lock, the lineMessageId
// pre-check, the after() backfill) stays testable without a DB. Must NOT
// import modules/line/service.ts: this file is imported BY service.ts, so
// importing back would be a cycle.

import { randomUUID } from 'node:crypto'
import { after } from 'next/server'
import type { Message, Prisma } from '@/lib/generated/prisma/client'
import type { Db, Tx } from '@/lib/db'
import type { Actor } from '@/lib/auth/dal'
import type { LineClient } from '@/modules/line/types'
import { DomainError } from '@/lib/errors'
import { getEnv } from '@/lib/env'
import { log } from '@/lib/log'
import { writeActivity } from '@/modules/audit/activity'
import { findOrCreateContactByLineUserId, findOrOpenLeadForContact } from '@/modules/crm/service'

/**
 * LINE docs give no exact webhook timeout, and no exact size limit either.
 * Bound the body so a hostile or broken sender cannot make us buffer or
 * JSON.parse an unbounded payload.
 */
export const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024

const REQUEST_ID_RE = /^[\w-]{1,128}$/

/** Mirrors lib/http.ts's own (unexported) request id resolution. */
export function resolveRequestId(headers: Headers): string {
  const incoming = headers.get('x-request-id')
  return incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID()
}

/** Duck-typed so this does not depend on class identity across module copies. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}

/** Truncated to 500 chars. Never the raw message of an unknown error. */
export function sanitizeError(err: unknown): string {
  let out: string
  if (err instanceof DomainError) {
    out = `${err.code}: ${err.message}`
  } else if (typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string') {
    const code = (err as { code: string }).code
    out = /^P\d{4}$/.test(code) ? `PRISMA ${code}` : `ERR ${code}`
  } else if (err instanceof Error) {
    out = err.name
  } else {
    out = 'unknown error'
  }
  return out.slice(0, 500)
}

const SYSTEM_ACTOR: Actor = { kind: 'system', source: 'line-webhook' }

/**
 * Transaction-scoped advisory lock keyed on the LINE user id, so two
 * concurrent webhook deliveries for the same user cannot both see "no
 * contact yet" and both insert one. $executeRaw, not $queryRaw: the lock
 * function returns void, which Prisma may fail to deserialize as a row. Safe
 * under PgBouncer transaction mode, because the lock is released at commit.
 */
export async function lockLineUser(tx: Tx, lineUserId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'line:user:' + lineUserId}::text, 0::bigint))`
}

/**
 * LINE_INBOUND_OWNER_EMAIL if it resolves to an active user, else the first
 * active ADMIN by createdAt. Throws UNPROCESSABLE when neither exists:
 * someone has to own the lead a new inbound contact opens.
 */
export async function resolveInboundOwnerId(tx: Tx): Promise<string> {
  const env = getEnv()
  let owner: { id: string } | null = null

  if (env.LINE_INBOUND_OWNER_EMAIL) {
    owner = await tx.user.findFirst({
      where: { email: { equals: env.LINE_INBOUND_OWNER_EMAIL, mode: 'insensitive' }, active: true },
      select: { id: true },
    })
    if (!owner) {
      log('warn', 'line.inbound_owner_fallback', {})
    }
  }

  if (!owner) {
    owner = await tx.user.findFirst({
      where: { role: 'ADMIN', active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
  }

  if (!owner) {
    throw new DomainError('UNPROCESSABLE', 'no active inbound owner (set LINE_INBOUND_OWNER_EMAIL or create an admin)')
  }
  return owner.id
}

/**
 * Runs inside the caller's transaction. Locks the LINE user, then a
 * lineMessageId pre-check (not catch-P2002: a P2002 inside an interactive
 * transaction aborts the whole transaction). After the lock, the pre-check is
 * race-free for the same user. Writes CONTACT_CREATED_FROM_LINE only when a
 * lead now exists to attach the activity to.
 */
export async function recordInbound(
  tx: Tx,
  input: {
    webhookEventRowId: string
    lineUserId: string
    lineMessageId: string
    text: string
    payload: Prisma.InputJsonValue
    receivedAt: Date
  },
): Promise<{ message: Message; contactId: string; leadId: string; contactCreated: boolean; duplicate: boolean }> {
  await lockLineUser(tx, input.lineUserId)

  const existing = await tx.message.findUnique({ where: { lineMessageId: input.lineMessageId } })
  if (existing) {
    if (!existing.leadId) {
      throw new DomainError('INTERNAL', 'duplicate inbound message has no leadId')
    }
    return {
      message: existing,
      contactId: existing.contactId,
      leadId: existing.leadId,
      contactCreated: false,
      duplicate: true,
    }
  }

  const { contact, created: contactCreated } = await findOrCreateContactByLineUserId(tx, {
    lineUserId: input.lineUserId,
    displayName: null,
  })
  const ownerId = await resolveInboundOwnerId(tx)
  const { lead } = await findOrOpenLeadForContact(tx, {
    contactId: contact.id,
    ownerId,
    source: 'LINE',
    actor: SYSTEM_ACTOR,
  })

  const message = await tx.message.create({
    data: {
      channel: 'LINE',
      direction: 'INBOUND',
      status: 'RECEIVED',
      body: input.text,
      payload: input.payload,
      contactId: contact.id,
      leadId: lead.id,
      lineMessageId: input.lineMessageId,
      webhookEventId: input.webhookEventRowId,
      createdAt: input.receivedAt,
    },
  })

  if (contactCreated) {
    await writeActivity(tx, {
      leadId: lead.id,
      type: 'CONTACT_CREATED_FROM_LINE',
      meta: { contactId: contact.id, messageId: message.id },
      actor: SYSTEM_ACTOR,
    })
  }

  return { message, contactId: contact.id, leadId: lead.id, contactCreated, duplicate: false }
}

/** Follow events only create/find the contact: there is no lead yet to attach an activity to. */
export async function recordFollow(
  tx: Tx,
  lineUserId: string,
): Promise<{ contactId: string; contactCreated: boolean }> {
  await lockLineUser(tx, lineUserId)
  const { contact, created } = await findOrCreateContactByLineUserId(tx, { lineUserId, displayName: null })
  return { contactId: contact.id, contactCreated: created }
}

/**
 * These literals are duplicated from lane A's modules/crm/service.ts
 * (findOrCreateContactByLineUserId ~L196, findOrOpenLeadForContact ~L222).
 * They must be kept in sync with that file if it ever changes. No CR exists
 * yet asking lane A to export them for reuse here; that call needs Pakorn,
 * and any CR entry in docs/contract-change-requests.md is lane E's to write.
 */
const CRM_PLACEHOLDER_FIRST_NAME = 'LINE user'
const LEAD_TITLE_PREFIX = 'LINE: '
const CRM_PLACEHOLDER_LEAD_TITLE = LEAD_TITLE_PREFIX + CRM_PLACEHOLDER_FIRST_NAME

/**
 * Zero-width, bidi-override and other invisible formatting characters that
 * can be used to spoof or hide characters in a display name: zero-width
 * space through right-to-left mark, the LRE/RLE/PDF/LRO/RLO bidi overrides,
 * line/paragraph separator, word joiner and friends, and the BOM / zero-width
 * no-break space. Built from numeric code points, never a literal \u escape
 * or a raw invisible character in this source file, so the ranges stay exact
 * and auditable.
 */
const INVISIBLE_BIDI_CODEPOINT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2028, 0x2029],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
]

function invisibleBidiCharClass(): string {
  return INVISIBLE_BIDI_CODEPOINT_RANGES.map(([start, end]) =>
    start === end ? String.fromCharCode(start) : String.fromCharCode(start) + '-' + String.fromCharCode(end),
  ).join('')
}

/**
 * C0/C1 controls plus the invisible/bidi characters above, as a regex
 * character class (bracket contents only, no flags). Exported so
 * app/api/dev/line/simulate/route.ts can reject the same set at input time;
 * this is the single source of truth for that set so the two never drift.
 */
export const CONTROL_OR_INVISIBLE_CHAR_CLASS = '\\x00-\\x1F\\x7F-\\x9F' + invisibleBidiCharClass()

const STRIP_TO_SPACE_RE = new RegExp('[' + CONTROL_OR_INVISIBLE_CHAR_CLASS + ']', 'g')
const WHITESPACE_RUN_RE = /\s+/g
const TRAILING_HIGH_SURROGATE_RE = /[\uD800-\uDBFF]$/

/**
 * Replaces (never deletes, so words do not run together) C0/C1 control
 * characters and the invisible/bidi characters above with a single space,
 * collapses runs of whitespace to one space, then trims. Caps to 100 UTF-16
 * units (matching the Contact.firstName / lineDisplayName budget) and trims
 * again after the cut. Drops a trailing lone high surrogate the cap may have
 * split off, so the result never ends mid surrogate pair. Empty after
 * cleanup -> null: no name worth writing.
 */
function normalizeDisplayName(raw: string): string | null {
  const spaced = raw.replace(STRIP_TO_SPACE_RE, ' ').replace(WHITESPACE_RUN_RE, ' ').trim()
  if (!spaced) return null
  return spaced.slice(0, 100).replace(TRAILING_HIGH_SURROGATE_RE, '').trim()
}

/**
 * Best effort only, meant to run inside scheduleAfter(). Reads the LINE
 * profile once and uses the normalized display name to fill in whatever is
 * still placeholder-shaped, never to overwrite something a human already
 * edited:
 *  - Contact.lineDisplayName, only while still null
 *  - Contact.firstName, only while still CRM_PLACEHOLDER_FIRST_NAME
 *  - the contact's open (non WON/LOST) Lead.title, only while still
 *    CRM_PLACEHOLDER_LEAD_TITLE
 * No Activity row: the schema is frozen and no ActivityType fits a profile
 * backfill. Never logs the display name itself, only counts. Never throws.
 */
export async function backfillContactProfile(
  db: Db,
  line: LineClient,
  input: { contactId: string; lineUserId: string },
): Promise<void> {
  try {
    const profile = await line.getProfile(input.lineUserId)
    if (!profile) return
    const name = normalizeDisplayName(profile.displayName)
    if (!name) return

    const [displayNameResult, firstNameResult, leadTitleResult] = await db.$transaction([
      db.contact.updateMany({
        where: { id: input.contactId, lineDisplayName: null },
        data: { lineDisplayName: name },
      }),
      db.contact.updateMany({
        where: { id: input.contactId, firstName: CRM_PLACEHOLDER_FIRST_NAME },
        data: { firstName: name },
      }),
      db.lead.updateMany({
        where: { contactId: input.contactId, title: CRM_PLACEHOLDER_LEAD_TITLE, stage: { notIn: ['WON', 'LOST'] } },
        data: { title: (LEAD_TITLE_PREFIX + name).slice(0, 200) },
      }),
    ])

    log('debug', 'line.profile_backfilled', {
      contactId: input.contactId,
      displayNameSet: displayNameResult.count,
      firstNameSet: firstNameResult.count,
      leadTitlesSet: leadTitleResult.count,
    })
  } catch {
    // Best effort: getProfile and the updates are both allowed to fail silently.
  }
}

/**
 * after() throws when called outside a request scope, for example from a
 * unit test that calls handleLineWebhook directly with no Next.js request
 * context. Swallow that one case quietly; log anything else as a warning.
 * Never throws.
 */
export function scheduleAfter(task: () => Promise<void>): void {
  try {
    after(task)
  } catch (err) {
    if (err instanceof Error && err.message.includes('outside a request scope')) {
      log('debug', 'line.profile_backfill_skipped', { reason: 'no_request_scope' })
    } else {
      log('warn', 'line.profile_backfill_skipped', { errName: err instanceof Error ? err.name : 'unknown' })
    }
  }
}
