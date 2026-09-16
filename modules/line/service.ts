// [signatures F, bodies C] modules/line/service.ts: see docs/design.md
// section 4, section 5A (webhook flow) and section 10 (retry / expiry rules).
// Lane C fills in the bodies; layer 0 only freezes the signatures.

import { randomUUID } from 'node:crypto'
import type { Message, Prisma } from '@/lib/generated/prisma/client'
import type { Db, Tx } from '@/lib/db'
import { getDb } from '@/lib/db'
import { canActOnLead, type Actor } from '@/lib/auth/dal'
import { DomainError } from '@/lib/errors'
import { log } from '@/lib/log'
import { LineWebhookBody } from '@/lib/contracts/line'
import type { LineClient, PushResult } from '@/modules/line/types'
import { sleep } from '@/modules/line/delay'
import { writeActivity } from '@/modules/audit/activity'
import {
  MAX_WEBHOOK_BODY_BYTES,
  backfillContactProfile,
  isUniqueViolation,
  recordFollow,
  recordInbound,
  sanitizeError,
  scheduleAfter,
} from '@/modules/line/webhook'

export type WebhookOutcome = {
  status: 200 | 400 | 401 | 413 | 500
  processed: number
  duplicates: number
  ignored: number
  failed: number
}

export async function handleLineWebhook(
  input: { rawBody: Buffer; signature: string | null; requestId: string },
  deps: { line: LineClient; db?: Db },
): Promise<WebhookOutcome> {
  const { rawBody, signature, requestId } = input
  const zero = { processed: 0, duplicates: 0, ignored: 0, failed: 0 }

  if (rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
    return { status: 413, ...zero }
  }

  if (!deps.line.verifySignature(rawBody, signature)) {
    log('warn', 'line.webhook.signature_invalid', {
      requestId,
      bytes: rawBody.length,
      sigPresent: signature !== null,
    })
    return { status: 401, ...zero }
  }

  // No DB access happens above this line.
  const db = deps.db ?? getDb()

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody.toString('utf8'))
  } catch {
    log('warn', 'line.webhook.invalid_body', { requestId, bytes: rawBody.length })
    return { status: 400, ...zero }
  }

  const parseResult = LineWebhookBody.safeParse(parsed)
  if (!parseResult.success) {
    log('warn', 'line.webhook.invalid_body', { requestId, bytes: rawBody.length })
    return { status: 400, ...zero }
  }

  const { events } = parseResult.data
  if (events.length === 0) {
    return { status: 200, ...zero }
  }

  let processed = 0
  let duplicates = 0
  let ignored = 0
  let failed = 0
  const createdContacts: Array<{ contactId: string; lineUserId: string }> = []

  for (const event of events) {
    const webhookEventId = event.webhookEventId
    const eventType = event.type
    const isRedelivery = event.deliveryContext?.isRedelivery ?? false

    let rowId: string
    try {
      const created = await db.webhookEvent.create({
        data: {
          webhookEventId,
          type: eventType,
          lineUserId: event.source?.userId ?? null,
          isRedelivery,
          eventTimestamp: new Date(event.timestamp),
          payload: event as unknown as Prisma.InputJsonValue,
          status: 'RECEIVED',
        },
      })
      rowId = created.id
    } catch (err) {
      if (!isUniqueViolation(err)) {
        failed++
        log('error', 'line.webhook.event_failed', { requestId, webhookEventId, eventType, err: sanitizeError(err) })
        continue
      }
      try {
        const dbExisting = await db.webhookEvent.findUnique({ where: { webhookEventId } })
        if (!dbExisting) {
          failed++
          log('error', 'line.webhook.event_failed', { requestId, webhookEventId, eventType, err: sanitizeError(err) })
          continue
        }
        if (dbExisting.status === 'PROCESSED' || dbExisting.status === 'IGNORED') {
          duplicates++
          log('info', 'line.webhook.duplicate', { requestId, webhookEventId, reason: 'webhookEventId', isRedelivery })
          continue
        }
        // FAILED or RECEIVED: a crashed or concurrent earlier attempt. Reprocessing
        // is safe because of the advisory lock and the lineMessageId guard.
        rowId = dbExisting.id
      } catch (findErr) {
        failed++
        log('error', 'line.webhook.event_failed', { requestId, webhookEventId, eventType, err: sanitizeError(findErr) })
        continue
      }
    }

    try {
      if (
        eventType === 'message' &&
        event.message?.type === 'text' &&
        typeof event.message.text === 'string' &&
        event.source?.userId
      ) {
        const lineUserId = event.source.userId
        const text = event.message.text
        const messageId = event.message.id
        const receivedAt = new Date(event.timestamp)

        const r = await db.$transaction(async (tx) => {
          const inner = await recordInbound(tx, {
            webhookEventRowId: rowId,
            lineUserId,
            lineMessageId: messageId,
            text,
            payload: event.message as unknown as Prisma.InputJsonValue,
            receivedAt,
          })
          await tx.webhookEvent.update({
            where: { id: rowId },
            data: { status: 'PROCESSED', processedAt: new Date(), error: null },
          })
          return inner
        })

        if (r.duplicate) {
          duplicates++
          log('info', 'line.webhook.duplicate', { requestId, webhookEventId, reason: 'lineMessageId', isRedelivery })
        } else {
          processed++
          log('info', 'line.webhook.event_processed', {
            requestId,
            webhookEventId,
            eventType,
            isRedelivery,
            leadId: r.leadId,
            messageId: r.message.id,
            contactCreated: r.contactCreated,
          })
          if (r.contactCreated) {
            createdContacts.push({ contactId: r.contactId, lineUserId })
          }
        }
      } else if (eventType === 'follow' && event.source?.userId) {
        const lineUserId = event.source.userId

        const r = await db.$transaction(async (tx) => {
          const inner = await recordFollow(tx, lineUserId)
          await tx.webhookEvent.update({
            where: { id: rowId },
            data: { status: 'PROCESSED', processedAt: new Date(), error: null },
          })
          return inner
        })

        processed++
        log('info', 'line.webhook.event_processed', {
          requestId,
          webhookEventId,
          eventType,
          isRedelivery,
          leadId: null,
          messageId: null,
          contactCreated: r.contactCreated,
        })
        if (r.contactCreated) {
          createdContacts.push({ contactId: r.contactId, lineUserId })
        }
      } else {
        await db.webhookEvent.update({
          where: { id: rowId },
          data: { status: 'IGNORED', processedAt: new Date() },
        })
        ignored++
        log('debug', 'line.webhook.event_ignored', { requestId, webhookEventId, eventType, isRedelivery })
      }
    } catch (err) {
      failed++
      try {
        // Never overwrites a PROCESSED row: a concurrent attempt may have
        // already committed its transaction after this one threw.
        await db.webhookEvent.updateMany({
          where: { id: rowId, status: { not: 'PROCESSED' } },
          data: { status: 'FAILED', error: sanitizeError(err) },
        })
      } catch {
        // Best effort: if this update also fails, the row keeps its prior status.
      }
      log('error', 'line.webhook.event_failed', { requestId, webhookEventId, eventType, err: sanitizeError(err) })
    }
  }

  for (const c of createdContacts) {
    scheduleAfter(() => backfillContactProfile(db, deps.line, c))
  }

  return { status: failed > 0 ? 500 : 200, processed, duplicates, ignored, failed }
}

export async function recordInboundMessage(
  tx: Tx,
  input: {
    webhookEventRowId: string
    lineUserId: string
    lineMessageId: string
    text: string
    payload: Prisma.InputJsonValue
    receivedAt: Date
  },
): Promise<{ message: Message; contactId: string; leadId: string; contactCreated: boolean }> {
  const result = await recordInbound(tx, input)
  return {
    message: result.message,
    contactId: result.contactId,
    leadId: result.leadId,
    contactCreated: result.contactCreated,
  }
}

/** How long a queued outbound LINE message's retryKey stays safe to reuse (section 10). */
export const RETRY_KEY_MAX_AGE_MS = 23 * 60 * 60 * 1000

/**
 * Used for the MESSAGE_SENT / MESSAGE_FAILED activity actor when a message's
 * original sender was a system actor (no sentById to restore on retry).
 */
const SYSTEM_ACTOR: Actor = { kind: 'system', source: 'line-webhook' }

/**
 * Runs inside the caller's transaction. Reads the lead, its contact and the
 * contact's lineUserId, and throws DomainError('UNPROCESSABLE', ...) when the
 * contact has no lineUserId: there is nothing to push a LINE message to.
 * Inserts an OUTBOUND / LINE / QUEUED Message row with a freshly generated
 * retryKey (crypto.randomUUID()). Makes no network call: the push itself
 * happens in deliverQueuedMessage.
 */
export async function enqueueLineMessage(
  tx: Tx,
  input: { leadId: string; text: string; actor: Actor; aiSuggestionId?: string },
): Promise<Message> {
  const lead = await tx.lead.findUnique({
    where: { id: input.leadId },
    select: { id: true, ownerId: true, contactId: true, contact: { select: { lineUserId: true } } },
  })
  if (!lead) {
    throw new DomainError('NOT_FOUND', 'lead not found')
  }
  if (!canActOnLead(input.actor, lead)) {
    throw new DomainError('FORBIDDEN', 'not allowed to act on this lead')
  }
  const lineUserId = lead.contact.lineUserId
  if (!lineUserId) {
    throw new DomainError('UNPROCESSABLE', 'contact has no LINE account linked')
  }
  const text = input.text.trim()
  if (text.length === 0 || text.length > 1000) {
    throw new DomainError('VALIDATION_FAILED', 'validation failed', {
      text: ['text must be 1 to 1000 characters'],
    })
  }

  return tx.message.create({
    data: {
      channel: 'LINE',
      direction: 'OUTBOUND',
      status: 'QUEUED',
      body: text,
      payload: { to: lineUserId, messages: [{ type: 'text', text }] },
      contactId: lead.contactId,
      leadId: lead.id,
      retryKey: randomUUID(),
      sentById: input.actor.kind === 'user' ? input.actor.id : null,
      aiSuggestionId: input.aiSuggestionId ?? null,
    },
  })
}

/**
 * Pushes the queued message with its STORED retryKey (never a fresh one),
 * following the in-request retry policy from section 10. A second
 * transaction (Tx B) then sets the message to SENT or FAILED and writes the
 * matching Activity. Refuses with DomainError('CONFLICT', ...) when the
 * message's createdAt is older than RETRY_KEY_MAX_AGE_MS, since LINE's retry
 * key is no longer safe to reuse past that window.
 */
export async function deliverQueuedMessage(
  messageId: string,
  deps: { line: LineClient; db?: Db },
): Promise<Message> {
  return deliver(messageId, deps)
}

/**
 * The shared body of deliverQueuedMessage and retryMessage. `actorOverride`
 * lets retryMessage record the person who actually clicked Retry as the
 * MESSAGE_SENT / MESSAGE_FAILED actor, instead of always falling back to the
 * message's original sender.
 */
async function deliver(
  messageId: string,
  deps: { line: LineClient; db?: Db },
  actorOverride?: Actor,
): Promise<Message> {
  const db = deps.db ?? getDb()
  const start = Date.now()

  const loaded = await db.message.findUnique({
    where: { id: messageId },
    include: {
      contact: { select: { lineUserId: true } },
      sentBy: { select: { id: true, role: true, name: true } },
    },
  })
  if (!loaded) {
    throw new DomainError('NOT_FOUND', 'message not found')
  }
  const { contact, sentBy, ...msg } = loaded

  if (msg.direction !== 'OUTBOUND' || msg.channel !== 'LINE' || !msg.retryKey) {
    throw new DomainError('UNPROCESSABLE', 'message is not a queued outbound LINE message')
  }
  if (msg.status === 'SENT') {
    return msg
  }
  if (msg.status !== 'QUEUED') {
    throw new DomainError('CONFLICT', 'message is not queued; use retry')
  }
  if (Date.now() - msg.createdAt.getTime() > RETRY_KEY_MAX_AGE_MS) {
    throw new DomainError('CONFLICT', 'retry key expired (older than 23 hours): send a new message')
  }

  const retryKey = msg.retryKey
  const leadId = msg.leadId

  let result: PushResult | undefined
  let attempt = 0

  if (!contact.lineUserId) {
    // No push is attempted: there is nothing to send to. Go straight to Tx B
    // as FAILED, per docs/design.md section 10.
    result = {
      ok: false,
      httpStatus: null,
      retryable: false,
      errorCode: 'CLIENT',
      message: 'contact no longer has a LINE user id',
      requestId: null,
    }
  } else {
    const to = contact.lineUserId
    for (attempt = 1; attempt <= 3; attempt++) {
      const claimed = await db.message.updateMany({
        where: { id: messageId, status: 'QUEUED' },
        data: { attemptCount: { increment: 1 } },
      })
      if (claimed.count === 0) {
        // Another caller already resolved this message (a concurrent
        // deliver or retry). Return the fresh row instead of racing it.
        return db.message.findUniqueOrThrow({ where: { id: messageId } })
      }

      result = await deps.line.push(to, [{ type: 'text', text: msg.body }], retryKey)

      if (!result.ok && result.retryable && attempt < 3) {
        log('warn', 'line.push.failed', {
          messageId,
          leadId,
          retryKey,
          attempt,
          httpStatus: result.httpStatus,
          errorCode: result.errorCode,
          willRetry: true,
        })
      }

      if (result.ok || !result.retryable || attempt === 3) break
      await sleep([300, 1200][attempt - 1])
    }
  }

  if (!result) {
    throw new DomainError('INTERNAL', 'push loop did not run')
  }
  const finalResult = result

  const data = finalResult.ok
    ? { status: 'SENT' as const, sentAt: new Date(), lineRequestId: finalResult.requestId, lastError: null }
    : {
        status: 'FAILED' as const,
        lastError: `${finalResult.errorCode} ${finalResult.httpStatus ?? '-'}: ${finalResult.message}`.slice(0, 500),
      }

  const updated = await db.$transaction(async (tx) => {
    const claim = await tx.message.updateMany({ where: { id: messageId, status: 'QUEUED' }, data })
    if (claim.count === 0) {
      // Someone else already moved this message out of QUEUED: leave the
      // activity to whoever won the race.
      return tx.message.findUniqueOrThrow({ where: { id: messageId } })
    }
    if (leadId) {
      await writeActivity(tx, {
        leadId,
        type: finalResult.ok ? 'MESSAGE_SENT' : 'MESSAGE_FAILED',
        body: null,
        meta: {
          messageId,
          retryKey,
          attempts: attempt,
          httpStatus: finalResult.httpStatus,
          ...(finalResult.ok ? { duplicate: finalResult.duplicate } : { errorCode: finalResult.errorCode }),
        },
        actor:
          actorOverride ?? (sentBy ? { kind: 'user', id: sentBy.id, role: sentBy.role, name: sentBy.name } : SYSTEM_ACTOR),
      })
    }
    return tx.message.findUniqueOrThrow({ where: { id: messageId } })
  })

  const durationMs = Date.now() - start
  if (!finalResult.ok) {
    log(finalResult.errorCode === 'CONFIG' ? 'error' : 'warn', 'line.push.failed', {
      messageId,
      leadId,
      retryKey,
      attempt,
      httpStatus: finalResult.httpStatus,
      errorCode: finalResult.errorCode,
      durationMs,
    })
  } else if (finalResult.duplicate) {
    log('info', 'line.push.duplicate_accepted', {
      messageId,
      leadId,
      retryKey,
      attempt,
      httpStatus: finalResult.httpStatus,
      errorCode: null,
      durationMs,
    })
  } else {
    log('info', 'line.push.ok', {
      messageId,
      leadId,
      retryKey,
      attempt,
      httpStatus: finalResult.httpStatus,
      errorCode: null,
      durationMs,
    })
  }

  return updated
}

/**
 * A single transaction that runs enqueueLineMessage, then hands off to
 * deliverQueuedMessage, so the enqueue insert and the push happen as one
 * user-facing send.
 */
export async function sendLineMessage(
  input: { leadId: string; text: string; actor: Actor; aiSuggestionId?: string },
  deps: { line: LineClient; db?: Db },
): Promise<Message> {
  const db = deps.db ?? getDb()
  const queued = await db.$transaction((tx) => enqueueLineMessage(tx, input))
  return deliverQueuedMessage(queued.id, { line: deps.line, db })
}

/**
 * A state check (the message exists, belongs to a lead the actor may act on,
 * and is FAILED or still QUEUED), followed by deliverQueuedMessage. Refuses
 * to retry messages older than RETRY_KEY_MAX_AGE_MS (LINE retry key expiry:
 * section 10).
 */
export async function retryMessage(
  input: { messageId: string; actor: Actor },
  deps: { line: LineClient; db?: Db },
): Promise<Message> {
  const db = deps.db ?? getDb()

  const msg = await db.message.findUnique({
    where: { id: input.messageId },
    include: { lead: { select: { ownerId: true } } },
  })
  if (!msg) {
    throw new DomainError('NOT_FOUND', 'message not found')
  }
  if (msg.direction !== 'OUTBOUND' || msg.channel !== 'LINE') {
    throw new DomainError('UNPROCESSABLE', 'only outbound LINE messages can be retried')
  }
  if (!msg.lead) {
    const allowed = input.actor.kind === 'system' || input.actor.role === 'ADMIN'
    if (!allowed) {
      throw new DomainError('FORBIDDEN', 'not allowed to act on this message')
    }
  } else if (!canActOnLead(input.actor, msg.lead)) {
    throw new DomainError('FORBIDDEN', 'not allowed to act on this message')
  }
  if (Date.now() - msg.createdAt.getTime() > RETRY_KEY_MAX_AGE_MS) {
    throw new DomainError(
      'CONFLICT',
      'This message is older than 23 hours, so its LINE retry key may have expired. Send it as a new message instead.',
    )
  }

  let claimed: { count: number }
  if (msg.status === 'FAILED') {
    claimed = await db.message.updateMany({
      where: { id: input.messageId, status: 'FAILED' },
      data: { status: 'QUEUED', lastError: null },
    })
  } else if (msg.status === 'QUEUED') {
    if (Date.now() - msg.updatedAt.getTime() < 60_000) {
      throw new DomainError('CONFLICT', 'message is still being delivered')
    }
    // Optimistic claim on updatedAt: the last write to this row (an
    // attemptCount bump, or this same check) must not have happened between
    // the read above and this update.
    claimed = await db.message.updateMany({
      where: { id: input.messageId, status: 'QUEUED', updatedAt: msg.updatedAt },
      data: { lastError: null },
    })
  } else {
    throw new DomainError('CONFLICT', 'message is not in a retryable state')
  }

  if (claimed.count === 0) {
    throw new DomainError('CONFLICT', 'message state changed before the retry could be claimed')
  }

  // attemptCount is never reset here: it is a lifetime counter across sends
  // and retries, incremented again inside deliver().
  try {
    return await deliver(input.messageId, deps, input.actor)
  } catch (err) {
    // The claim above already moved this row to QUEUED. If deliver() throws
    // before it reaches Tx B (a raced 23h expiry, a DB error, ...), the
    // message would otherwise be stranded as QUEUED with nothing left to
    // resolve it. Revert to FAILED, best effort, then rethrow the real error.
    try {
      await db.message.updateMany({
        where: { id: input.messageId, status: 'QUEUED' },
        data: { status: 'FAILED', lastError: sanitizeError(err) },
      })
    } catch {
      // Best effort: if this update also fails, the row keeps its QUEUED status.
    }
    throw err
  }
}

/**
 * Logs an offline / non-LINE conversation turn with no network call and no
 * Activity: there is no ActivityType for a manually logged message.
 */
export async function logManualMessage(
  input: { leadId: string; text: string; direction: 'INBOUND' | 'OUTBOUND'; actor: Actor },
  deps: { db?: Db } = {},
): Promise<Message> {
  const db = deps.db ?? getDb()

  const lead = await db.lead.findUnique({
    where: { id: input.leadId },
    select: { id: true, ownerId: true, contactId: true },
  })
  if (!lead) {
    throw new DomainError('NOT_FOUND', 'lead not found')
  }
  if (!canActOnLead(input.actor, lead)) {
    throw new DomainError('FORBIDDEN', 'not allowed to act on this lead')
  }

  const text = input.text.trim()
  if (text.length === 0 || text.length > 1000) {
    throw new DomainError('VALIDATION_FAILED', 'validation failed', {
      text: ['text must be 1 to 1000 characters'],
    })
  }

  return db.message.create({
    data: {
      channel: 'MANUAL',
      direction: input.direction,
      status: 'LOGGED',
      body: text,
      contactId: lead.contactId,
      leadId: lead.id,
      sentById: input.direction === 'OUTBOUND' && input.actor.kind === 'user' ? input.actor.id : null,
    },
  })
}
