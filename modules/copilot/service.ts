// [signatures F, bodies B] modules/copilot/service.ts: see docs/design.md
// section 4 and section 5B (draft -> approve -> send flow). Lane B fills in
// the bodies; layer 0 only freezes the signatures.

import { z } from 'zod'
import type { AiSuggestion, Message, Prisma } from '@/lib/generated/prisma/client'
import type { Db } from '@/lib/db'
import { getDb } from '@/lib/db'
import { canActOnLead, type Actor } from '@/lib/auth/dal'
import { DomainError } from '@/lib/errors'
import { log } from '@/lib/log'
import { NextBestActionSchema, type CopilotOutput } from '@/lib/contracts/copilot'
import type { LineClient } from '@/modules/line/types'
import { deliverQueuedMessage, enqueueLineMessage } from '@/modules/line/service'
import { writeActivity } from '@/modules/audit'
import { suggestWithFallback } from '@/modules/copilot/fallback'
import { buildLeadContext } from '@/modules/copilot/context'
import { getSuggestDeps } from '@/modules/copilot/model'
import { clampScore } from '@/modules/copilot/guardrails'

export async function requestInsight(
  input: { leadId: string; actor: Actor; replyLocale?: 'th' | 'en' },
  deps: { suggest?: typeof suggestWithFallback; db?: Db },
): Promise<AiSuggestion> {
  const db = deps.db ?? getDb()
  const suggest = deps.suggest ?? suggestWithFallback
  // Aliased to a local const (rather than narrowing `input.actor.kind`
  // in place) so the 'user' narrowing survives into the $transaction
  // closure below, where `actor.id` is read again.
  const { actor } = input

  // Only a signed-in user can ask for an insight: the LINE webhook and seed
  // system actors never trigger the model on their own (design section 5B).
  if (actor.kind !== 'user') {
    throw new DomainError('FORBIDDEN', 'only a signed-in user can request an insight')
  }

  const ctx = await buildLeadContext(db, { leadId: input.leadId, replyLocale: input.replyLocale })
  if (!ctx) throw new DomainError('NOT_FOUND', 'lead not found')

  // suggestWithFallback never throws: a model failure always turns into a
  // FALLBACK result, never a 5xx from this route (design section 5B).
  const result = await suggest(ctx, getSuggestDeps())

  return db.$transaction(async (tx) => {
    // Serializes concurrent "Ask AI" clicks on the same lead against each
    // other, so the supersede-then-insert pair below can't interleave.
    await tx.$queryRaw`SELECT "id" FROM "Lead" WHERE "id" = ${input.leadId} FOR UPDATE`

    await tx.aiSuggestion.updateMany({
      where: { leadId: input.leadId, status: 'PENDING' },
      data: { status: 'SUPERSEDED' },
    })

    const created = await tx.aiSuggestion.create({
      data: {
        leadId: input.leadId,
        status: 'PENDING',
        source: result.source,
        lowConfidence: result.lowConfidence,
        confidence: result.output.confidence,
        summary: result.output.summary,
        score: result.output.score,
        scoreReasons: result.output.scoreReasons as Prisma.InputJsonValue,
        nextBestAction: result.output.nextBestAction as Prisma.InputJsonValue,
        draftReply: result.output.draftReply?.text ?? null,
        flags: result.output.flags,
        model: result.model,
        promptVersion: result.promptVersion,
        latencyMs: Math.round(result.latencyMs),
        errorCode: result.errorCode,
        requestedById: actor.id,
      },
    })

    await writeActivity(tx, {
      leadId: input.leadId,
      type: 'AI_SUGGESTION_CREATED',
      meta: {
        suggestionId: created.id,
        source: result.source,
        lowConfidence: result.lowConfidence,
        errorCode: result.errorCode,
        score: result.output.score,
      } as Prisma.InputJsonValue,
      actor,
    })

    // This transaction never touches a Lead field and never creates a
    // Message row: an AI suggestion is a draft, not a confirmed write
    // (design section 5B's line between "AI suggestion" and "confirmed data").
    return created
  })
}

export async function approveSuggestion(
  input: { suggestionId: string; actor: Actor; send: boolean; replyText?: string; applyScore: boolean },
  deps: { line: LineClient; db?: Db },
): Promise<{ suggestion: AiSuggestion; message: Message | null }> {
  const db = deps.db ?? getDb()

  const existing = await db.aiSuggestion.findUnique({
    where: { id: input.suggestionId },
    include: {
      lead: { select: { id: true, ownerId: true, score: true, contact: { select: { lineUserId: true } } } },
    },
  })

  // Every pre-check below runs before any write: 404, then 403, then the 409
  // fast path, then the two 422s, all fail closed with nothing touched yet.
  if (!existing) throw new DomainError('NOT_FOUND', 'suggestion not found')
  if (!canActOnLead(input.actor, existing.lead)) {
    throw new DomainError('FORBIDDEN', 'only the lead owner or an admin can approve a suggestion')
  }
  if (existing.status !== 'PENDING') {
    throw new DomainError('CONFLICT', 'suggestion is no longer pending')
  }

  const text = input.replyText ?? existing.draftReply?.trim()
  if (input.send && !existing.lead.contact.lineUserId) {
    throw new DomainError('UNPROCESSABLE', 'contact has no LINE account linked')
  }
  if (input.send && !text) {
    throw new DomainError('UNPROCESSABLE', 'there is no reply text to send')
  }

  const edited = input.replyText !== undefined && input.replyText !== (existing.draftReply ?? '').trim()
  const decidedById = input.actor.kind === 'user' ? input.actor.id : null

  // Tx A: commits before any network call, so the message's retryKey (if a
  // send is requested) is durable before deliverQueuedMessage ever runs.
  const { approved, queued } = await db.$transaction(async (tx) => {
    const { count } = await tx.aiSuggestion.updateMany({
      where: { id: input.suggestionId, status: 'PENDING' },
      data: { status: 'APPROVED', decidedById, decidedAt: new Date() },
    })
    // A concurrent approve/reject won the race between the pre-check above
    // and this update: fail the same way a stale read would.
    if (count === 0) throw new DomainError('CONFLICT', 'suggestion is no longer pending')

    if (input.applyScore) {
      const appliedScore = clampScore(existing.score)
      await tx.lead.update({
        where: { id: existing.lead.id },
        data: { score: appliedScore, scoreUpdatedAt: new Date() },
      })
      await writeActivity(tx, {
        leadId: existing.lead.id,
        type: 'SCORE_APPLIED',
        meta: {
          suggestionId: input.suggestionId,
          score: appliedScore,
          previousScore: existing.lead.score,
        } as Prisma.InputJsonValue,
        actor: input.actor,
      })
    }

    let queuedMessage: Message | null = null
    if (input.send) {
      queuedMessage = await enqueueLineMessage(tx, {
        leadId: existing.lead.id,
        // Guaranteed non-empty here: the 422 check above already rejected
        // send:true with no text before this transaction ever started.
        text: text as string,
        actor: input.actor,
        aiSuggestionId: input.suggestionId,
      })
    }

    await writeActivity(tx, {
      leadId: existing.lead.id,
      type: 'AI_SUGGESTION_APPROVED',
      meta: {
        suggestionId: input.suggestionId,
        source: existing.source,
        edited,
        send: input.send,
        applyScore: input.applyScore,
        messageId: queuedMessage?.id ?? null,
      } as Prisma.InputJsonValue,
      actor: input.actor,
    })

    const approvedRow = await tx.aiSuggestion.findUniqueOrThrow({ where: { id: input.suggestionId } })
    return { approved: approvedRow, queued: queuedMessage }
  })

  // Outside the transaction: the push to LINE itself. A delivery failure is
  // logged (safe fields only, never the message body) and swallowed, never
  // rethrown: the suggestion is already APPROVED and must stay that way.
  let message: Message | null = queued
  if (queued) {
    try {
      message = await deliverQueuedMessage(queued.id, { line: deps.line, db })
    } catch (err) {
      log('error', 'copilot.approve_delivery_error', {
        suggestionId: input.suggestionId,
        leadId: existing.lead.id,
        messageId: queued.id,
        errName: err instanceof Error ? err.name : null,
      })
      try {
        message = await db.message.findUnique({ where: { id: queued.id } })
      } catch {
        message = queued
      }
    }
  }

  return { suggestion: approved, message }
}

export async function rejectSuggestion(
  input: { suggestionId: string; actor: Actor; reason?: string },
  db?: Db,
): Promise<AiSuggestion> {
  const database = db ?? getDb()

  const existing = await database.aiSuggestion.findUnique({
    where: { id: input.suggestionId },
    include: { lead: { select: { id: true, ownerId: true } } },
  })

  if (!existing) throw new DomainError('NOT_FOUND', 'suggestion not found')
  if (!canActOnLead(input.actor, existing.lead)) {
    throw new DomainError('FORBIDDEN', 'only the lead owner or an admin can reject a suggestion')
  }

  const decidedById = input.actor.kind === 'user' ? input.actor.id : null
  const body = input.reason?.trim() || null

  return database.$transaction(async (tx) => {
    const { count } = await tx.aiSuggestion.updateMany({
      where: { id: input.suggestionId, status: 'PENDING' },
      data: { status: 'REJECTED', decidedById, decidedAt: new Date() },
    })
    if (count === 0) throw new DomainError('CONFLICT', 'suggestion is no longer pending')

    await writeActivity(tx, {
      leadId: existing.lead.id,
      type: 'AI_SUGGESTION_REJECTED',
      body,
      meta: { suggestionId: input.suggestionId, source: existing.source } as Prisma.InputJsonValue,
      actor: input.actor,
    })

    return tx.aiSuggestion.findUniqueOrThrow({ where: { id: input.suggestionId } })
  })
}

/** History for the InsightPanel: newest first, plus whether the lead's contact has LINE (for the "Send via LINE" checkbox). */
export async function listSuggestions(
  leadId: string,
  opts: { limit: number },
  db?: Db,
): Promise<{ items: AiSuggestion[]; hasLine: boolean }> {
  const database = db ?? getDb()

  const lead = await database.lead.findUnique({
    where: { id: leadId },
    select: { id: true, contact: { select: { lineUserId: true } } },
  })
  if (!lead) throw new DomainError('NOT_FOUND', 'lead not found')

  const items = await database.aiSuggestion.findMany({
    where: { leadId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit,
  })

  return { items, hasLine: lead.contact.lineUserId !== null }
}

/** Wire shape for one AiSuggestion row: Json columns parsed back to their typed shape, dates as ISO strings. */
export type SuggestionView = {
  id: string
  leadId: string
  status: AiSuggestion['status']
  source: AiSuggestion['source']
  lowConfidence: boolean
  confidence: number | null
  summary: string
  score: number
  scoreReasons: string[]
  nextBestAction: CopilotOutput['nextBestAction'] | null
  draftReply: string | null
  flags: string[]
  model: string | null
  promptVersion: string
  latencyMs: number | null
  errorCode: string | null
  requestedById: string
  decidedById: string | null
  decidedAt: string | null
  createdAt: string
}

const scoreReasonsSchema = z.array(z.string()).catch([])
const nextBestActionViewSchema = NextBestActionSchema.nullable().catch(null)

/** A row's Json columns were written by this same module, but are parsed defensively (`.catch`) rather than cast, in case an older row predates a schema change. */
export function toSuggestionView(row: AiSuggestion): SuggestionView {
  return {
    id: row.id,
    leadId: row.leadId,
    status: row.status,
    source: row.source,
    lowConfidence: row.lowConfidence,
    confidence: row.confidence,
    summary: row.summary,
    score: row.score,
    scoreReasons: scoreReasonsSchema.parse(row.scoreReasons),
    nextBestAction: nextBestActionViewSchema.parse(row.nextBestAction),
    draftReply: row.draftReply,
    flags: row.flags,
    model: row.model,
    promptVersion: row.promptVersion,
    latencyMs: row.latencyMs,
    errorCode: row.errorCode,
    requestedById: row.requestedById,
    decidedById: row.decidedById,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Wire shape for the approve response's message: never the body or the retryKey, only enough to show delivery status. */
export type ApprovedMessageView = {
  id: string
  status: Message['status']
  attemptCount: number
  lastError: string | null
  sentAt: string | null
  createdAt: string
}

export function toApprovedMessageView(message: Message): ApprovedMessageView {
  return {
    id: message.id,
    status: message.status,
    attemptCount: message.attemptCount,
    lastError: message.lastError,
    sentAt: message.sentAt ? message.sentAt.toISOString() : null,
    createdAt: message.createdAt.toISOString(),
  }
}
