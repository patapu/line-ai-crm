// [signatures F, bodies C] modules/line/service.ts: see docs/design.md
// section 4, section 5A (webhook flow) and section 10 (retry / expiry rules).
// Lane C fills in the bodies; layer 0 only freezes the signatures.

import type { Message, Prisma } from '@/lib/generated/prisma/client'
import type { Db, Tx } from '@/lib/db'
import type { Actor } from '@/lib/auth/dal'
import { DomainError } from '@/lib/errors'
import type { LineClient } from '@/modules/line/types'

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
  void input
  void deps
  throw new DomainError('INTERNAL', 'not implemented')
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
  void tx
  void input
  throw new DomainError('INTERNAL', 'not implemented')
}

/** How long a queued outbound LINE message's retryKey stays safe to reuse (section 10). */
export const RETRY_KEY_MAX_AGE_MS = 23 * 60 * 60 * 1000

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
  void tx
  void input
  throw new DomainError('INTERNAL', 'not implemented')
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
  void messageId
  void deps
  throw new DomainError('INTERNAL', 'not implemented')
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
  void input
  void deps
  throw new DomainError('INTERNAL', 'not implemented')
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
  void input
  void deps
  throw new DomainError('INTERNAL', 'not implemented')
}
