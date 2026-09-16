// OWNER: lane B (stub from layer 0)
//
// Signatures frozen per docs/design.md section 4 and the guardrail/fallback
// rules in the surrounding prose (score bands, guardrail checks, the 6
// wrapper rules). Lane B fills in the bodies. `suggestWithFallback` itself
// must never throw once implemented for real: the layer 0 stub throws only
// as a placeholder so nothing calls an unimplemented function silently.

import { ZodError } from 'zod'
import { APICallError, JSONParseError, NoObjectGeneratedError, NoOutputGeneratedError, RetryError, TypeValidationError } from 'ai'
import { log } from '@/lib/log'
import { CopilotOutputSchema } from '@/lib/contracts/copilot'
import type { CopilotErrorCode, CopilotOutput, CopilotResult, CrmCopilot, LeadContext } from '@/modules/copilot/types'
import { clampScore, findDraftViolations } from '@/modules/copilot/guardrails'
import { PROMPT_VERSION } from '@/modules/copilot/instructions'

export interface SuggestDeps {
  copilot: CrmCopilot | null // null when GOOGLE_GENERATIVE_AI_API_KEY is unset
  timeoutMs: number // COPILOT_TIMEOUT_MS, default 8000
  minConfidence: number // COPILOT_MIN_CONFIDENCE, default 0.5
}

// Not exported: the rule-based path is an internal implementation detail of
// this module's fallback, not part of the frozen public surface.
const FALLBACK_VERSION = 'rules-v1'
const FALLBACK_CONFIDENCE = 0.3
const DAY_MS = 86_400_000

const BASE_SCORE_BY_STAGE: Record<LeadContext['lead']['stage'], number> = {
  NEW: 20,
  QUALIFIED: 45,
  PROPOSAL: 65,
  WON: 100,
  LOST: 0,
}

type NextBestAction = CopilotOutput['nextBestAction']

const NEXT_BEST_ACTION_BY_STAGE: Record<LeadContext['lead']['stage'], (hasLine: boolean) => NextBestAction> = {
  NEW: (hasLine) => ({
    type: hasLine ? 'REPLY_LINE' : 'CALL',
    title: 'Make first contact and qualify needs',
    rationale: 'New lead: confirm needs, budget and timeline first.',
    suggestedStage: null,
    dueInDays: 1,
  }),
  QUALIFIED: () => ({
    type: 'SEND_PROPOSAL',
    title: 'Send a proposal',
    rationale: 'Lead is qualified: a written proposal is the next step.',
    suggestedStage: 'PROPOSAL',
    dueInDays: 3,
  }),
  PROPOSAL: () => ({
    type: 'CALL',
    title: 'Call to follow up on the proposal',
    rationale: 'A proposal is out: a call surfaces objections early.',
    suggestedStage: null,
    dueInDays: 2,
  }),
  WON: () => ({
    type: 'FOLLOW_UP_LATER',
    title: 'Check in after onboarding',
    rationale: 'Deal is won: keep the relationship warm.',
    suggestedStage: null,
    dueInDays: 14,
  }),
  LOST: () => ({
    type: 'FOLLOW_UP_LATER',
    title: 'Leave the door open, no sales push',
    rationale: 'Deal is lost: a light check-in later, without pressure.',
    suggestedStage: null,
    dueInDays: 30,
  }),
}

const DRAFT_TEMPLATES = {
  open: {
    th: (name: string) =>
      `สวัสดีค่ะ คุณ${name} ขอบคุณที่ติดต่อเข้ามานะคะ ทีมงานขอสอบถามรายละเอียดเพิ่มเติมเล็กน้อย เพื่อแนะนำตัวเลือกที่เหมาะกับคุณ${name}ที่สุดค่ะ สะดวกให้ติดต่อกลับช่วงไหนคะ`,
    en: (name: string) =>
      `Hi ${name}, thank you for reaching out. Could you share a few more details about what you need, so we can suggest the best option for you? When is a good time for us to follow up?`,
  },
  closed: {
    th: (name: string) => `สวัสดีค่ะ คุณ${name} ขอบคุณที่ติดต่อกับเรานะคะ หากมีอะไรให้ทีมงานช่วยเพิ่มเติม แจ้งได้ตลอดเลยค่ะ`,
    en: (name: string) => `Hi ${name}, thank you for being in touch with us. If there is anything else we can help with, just let us know.`,
  },
}

/** null when the contact has no LINE, or when the template itself trips a guardrail. */
function draftTemplate(ctx: LeadContext): CopilotOutput['draftReply'] {
  if (!ctx.contact.hasLine) return null

  const group = ctx.lead.stage === 'WON' || ctx.lead.stage === 'LOST' ? 'closed' : 'open'
  const text = DRAFT_TEMPLATES[group][ctx.replyLocale](ctx.contact.firstName)

  if (findDraftViolations(text, ctx).length > 0) return null
  return { text, locale: ctx.replyLocale }
}

function latestAt(items: Array<{ at: string }>): string | null {
  return items.reduce<string | null>((latest, item) => {
    if (latest === null || Date.parse(item.at) > Date.parse(latest)) return item.at
    return latest
  }, null)
}

/** Pure rule-based suggestion, used both directly by the fallback path and to build the guardrail-safe fallback draft/NBA when the model itself fails. */
export function ruleBasedSuggestion(ctx: LeadContext): CopilotOutput {
  const now = Date.parse(ctx.now)
  const stage = ctx.lead.stage
  const base = BASE_SCORE_BY_STAGE[stage]

  let score = base
  const scoreReasons: string[] = [`Stage ${stage}: base score ${base}`]

  const recentInbound = ctx.recentMessages.some(
    (m) => m.direction === 'INBOUND' && now - Date.parse(m.at) <= 3 * DAY_MS,
  )
  if (recentInbound) {
    score += 15
    scoreReasons.push('Customer messaged in the last 3 days (+15)')
  }

  if (ctx.lead.value !== null) {
    score += 10
    scoreReasons.push('Deal value is set (+10)')
  }

  const touches = [...ctx.recentMessages, ...ctx.recentActivities]
  const lastTouch = latestAt(touches) ?? ctx.lead.createdAt
  const daysSinceTouch = (now - Date.parse(lastTouch)) / DAY_MS
  if (daysSinceTouch > 14) {
    score -= 15
    scoreReasons.push(`No activity for ${Math.floor(daysSinceTouch)} days (-15)`)
  }

  score = clampScore(score)

  const inboundMessages = ctx.recentMessages.filter((m) => m.direction === 'INBOUND')
  const lastInbound = inboundMessages.at(-1) ?? null
  const lastInboundDays = lastInbound ? Math.floor((now - Date.parse(lastInbound.at)) / DAY_MS) : null

  const { firstName, lastName, companyName } = ctx.contact
  const { title, value, currency } = ctx.lead
  const summary = `${firstName}${lastName ? ' ' + lastName : ''}${companyName ? ` (${companyName})` : ''}: lead "${title}" is at stage ${stage}${value !== null ? ` with value ${value.toLocaleString('en-US')} ${currency}` : ''}. ${ctx.recentMessages.length} recent message(s), ${lastInbound ? `last customer message ${lastInboundDays} day(s) ago` : 'no customer messages yet'}. Rule-based summary, the AI suggestion was unavailable.`.slice(
    0,
    800,
  )

  // STAGE_CHANGED activities always get a derived text summary from
  // context.ts (see parseStageChangeMeta there), even for a lead with no
  // real conversation at all. Excluded here so a stage transition alone
  // never counts as "content" and masks a genuinely empty lead behind a
  // false hasAnyText, which would otherwise suppress the
  // INSUFFICIENT_CONTEXT flag it should get.
  const hasAnyText =
    ctx.recentMessages.length > 0 || ctx.recentActivities.some((a) => a.text !== null && a.type !== 'STAGE_CHANGED')

  return {
    summary,
    score,
    scoreReasons,
    nextBestAction: NEXT_BEST_ACTION_BY_STAGE[stage](ctx.contact.hasLine),
    draftReply: draftTemplate(ctx),
    confidence: FALLBACK_CONFIDENCE,
    flags: hasAnyText ? [] : ['INSUFFICIENT_CONTEXT'],
  }
}

export function applyGuardrails(out: CopilotOutput, ctx: LeadContext): { output: CopilotOutput; blocked: string[] } {
  const score = clampScore(out.score)

  // No LINE contact: there is nowhere to send a draft reply, so drop it.
  // This is not a guardrail block (nothing about the draft's content is a
  // problem), just a null-out, so `blocked` stays empty and errorCode is
  // unaffected.
  if (!ctx.contact.hasLine) {
    return { output: { ...out, score, draftReply: null }, blocked: [] }
  }

  // A model draft whose declared locale does not match ctx.replyLocale is
  // treated as blocked (same as a content violation) so it gets replaced by
  // the guardrail-safe template: 'LOCALE_MISMATCH' is added to `blocked`
  // directly rather than to the GuardrailViolation union in guardrails.ts,
  // since it is a wrapper-level check on the whole draft, not a draft
  // *content* problem findDraftViolations can see.
  const localeMismatch = out.draftReply !== null && out.draftReply.locale !== ctx.replyLocale
  const contentViolations = out.draftReply ? findDraftViolations(out.draftReply.text, ctx) : []
  const blocked: string[] = localeMismatch ? [...contentViolations, 'LOCALE_MISMATCH'] : contentViolations
  const draftReply = blocked.length > 0 ? draftTemplate(ctx) : out.draftReply

  return { output: { ...out, score, draftReply }, blocked }
}

function classifyError(err: unknown): CopilotErrorCode {
  if (RetryError.isInstance(err)) return classifyError(err.lastError)

  if (
    NoObjectGeneratedError.isInstance(err) ||
    NoOutputGeneratedError.isInstance(err) ||
    TypeValidationError.isInstance(err) ||
    JSONParseError.isInstance(err) ||
    err instanceof ZodError
  ) {
    return 'SCHEMA_INVALID'
  }

  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) return 'TIMEOUT'

  return 'PROVIDER_ERROR'
}

function logSuggestion(ctx: LeadContext, result: CopilotResult, blocked: string[]): void {
  log('info', 'copilot.suggest', {
    leadId: ctx.lead.id,
    source: result.source,
    errorCode: result.errorCode,
    lowConfidence: result.lowConfidence,
    model: result.model,
    promptVersion: result.promptVersion,
    latencyMs: result.latencyMs,
    score: result.output.score,
    confidence: result.output.confidence,
    flags: result.output.flags,
    blocked,
    draftLength: result.output.draftReply?.text.length ?? 0,
  })
}

function fallback(
  ctx: LeadContext,
  code: CopilotErrorCode,
  latencyMs: number,
  err?: unknown,
  attemptedModel?: string | null,
): CopilotResult {
  const { output, blocked } = applyGuardrails(ruleBasedSuggestion(ctx), ctx)

  const result: CopilotResult = {
    output: { ...output, confidence: FALLBACK_CONFIDENCE },
    source: 'FALLBACK',
    lowConfidence: true,
    errorCode: code,
    model: null,
    promptVersion: FALLBACK_VERSION,
    latencyMs,
  }

  logSuggestion(ctx, result, blocked)
  log('warn', 'copilot.fallback_used', {
    leadId: ctx.lead.id,
    errorCode: code,
    attemptedModel: attemptedModel ?? null,
    latencyMs,
    errName: err instanceof Error ? err.name : null,
    httpStatus: APICallError.isInstance(err) ? (err.statusCode ?? null) : null,
  })

  return result
}

// Hard-coded, built by hand rather than via ruleBasedSuggestion/
// applyGuardrails so it cannot itself throw (an unrecognized ctx.lead.stage
// is exactly the kind of bad input that makes ruleBasedSuggestion throw).
// Every field is chosen to satisfy CopilotOutputSchema by construction, so
// there is nothing left to validate. confidence is FALLBACK_CONFIDENCE, not
// 0, so this still reads as "a low-confidence rule-based guess" rather than
// "zero confidence", consistent with every other FALLBACK result. Built
// fresh on every call (a function, not a shared constant) so two callers can
// never observe or mutate the same nextBestAction/scoreReasons/flags object.
function buildLastResortOutput(): CopilotOutput {
  return {
    summary: 'AI suggestion unavailable right now.',
    score: 0,
    scoreReasons: ['AI suggestion unavailable right now.'],
    nextBestAction: {
      type: 'FOLLOW_UP_LATER',
      title: 'Follow up later',
      rationale: 'AI suggestion unavailable right now.',
      suggestedStage: null,
      dueInDays: null,
    },
    draftReply: null,
    confidence: FALLBACK_CONFIDENCE,
    flags: ['INSUFFICIENT_CONTEXT'],
  }
}

/**
 * The true last resort: used only when `fallback()` above itself throws.
 * Never touches `ctx` beyond its `id` for logging, never calls
 * ruleBasedSuggestion/applyGuardrails/draftTemplate, so it cannot throw.
 * `code` preserves whatever errorCode the caller originally intended (e.g.
 * NO_API_KEY), so a crash in the rule-based path never masks the real
 * reason a fallback was needed in the first place behind a generic
 * PROVIDER_ERROR.
 */
function lastResortFallback(latencyMs: number, code: CopilotErrorCode = 'PROVIDER_ERROR'): CopilotResult {
  return {
    output: buildLastResortOutput(),
    source: 'FALLBACK',
    lowConfidence: true,
    errorCode: code,
    model: null,
    promptVersion: FALLBACK_VERSION,
    latencyMs,
  }
}

/**
 * Wraps `fallback()` so a crash inside the rule-based path itself (e.g. an
 * unrecognized ctx.lead.stage, or ctx.lead being missing altogether) can
 * never escape as a rejected promise: falls through to the hard-coded,
 * un-throwable last resort instead, keeping the originally intended `code`.
 * `ctx?.lead?.id` (not `ctx.lead.id`) because the very thing being guarded
 * against here is ctx.lead being absent.
 */
function safeFallback(
  ctx: LeadContext,
  code: CopilotErrorCode,
  latencyMs: number,
  err?: unknown,
  attemptedModel?: string | null,
): CopilotResult {
  try {
    return fallback(ctx, code, latencyMs, err, attemptedModel)
  } catch (fallbackErr) {
    log('error', 'copilot.fallback_crashed', {
      leadId: ctx?.lead?.id ?? null,
      errorCode: code,
      attemptedModel: attemptedModel ?? null,
      errName: fallbackErr instanceof Error ? fallbackErr.name : null,
      // The error that originally sent us down the fallback path (e.g. the
      // provider error/timeout), distinct from `errName` above (the crash
      // inside the rule-based fallback itself): the two are never the same
      // event, and collapsing them would hide which one actually happened.
      causeErrName: err instanceof Error ? err.name : null,
    })
    return lastResortFallback(latencyMs, code)
  }
}

export async function suggestWithFallback(ctx: LeadContext, deps: SuggestDeps): Promise<CopilotResult> {
  const started = performance.now()
  const elapsed = () => Math.max(0, Math.round(performance.now() - started))

  try {
    const { copilot } = deps
    if (!copilot) return safeFallback(ctx, 'NO_API_KEY', elapsed())

    const controller = new AbortController()
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined

    // Second timeout layered on top of the SDK's own `timeout` option (design
    // section 4, wrapper rule 2). A no-op catch keeps this from surfacing as
    // an unhandled rejection when `copilot.suggest` wins the race instead.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        const timeoutError = new Error('copilot wrapper timeout')
        timeoutError.name = 'TimeoutError'
        controller.abort(timeoutError)
        reject(timeoutError)
      }, deps.timeoutMs)
    })
    timeout.catch(() => {})

    let raw: unknown
    try {
      raw = await Promise.race([Promise.resolve().then(() => copilot.suggest(ctx, controller.signal)), timeout])
    } catch (err) {
      return safeFallback(ctx, timedOut ? 'TIMEOUT' : classifyError(err), elapsed(), err, copilot.model)
    } finally {
      clearTimeout(timer)
    }

    const parsed = CopilotOutputSchema.safeParse(raw)
    if (!parsed.success) return safeFallback(ctx, 'SCHEMA_INVALID', elapsed(), parsed.error, copilot.model)

    const { output, blocked } = applyGuardrails(parsed.data, ctx)
    const lowConfidence =
      blocked.length > 0 || output.confidence < deps.minConfidence || output.flags.includes('INSUFFICIENT_CONTEXT')

    const result: CopilotResult = {
      output,
      source: 'MODEL',
      lowConfidence,
      errorCode: blocked.length > 0 ? 'GUARDRAIL_BLOCKED' : null,
      model: copilot.model,
      promptVersion: PROMPT_VERSION,
      latencyMs: elapsed(),
    }

    logSuggestion(ctx, result, blocked)
    return result
  } catch (err) {
    // Anything unexpected elsewhere in the try block above (not already
    // handled by one of the safeFallback calls): safeFallback() itself can
    // never throw, so this alone is enough to guarantee
    // suggestWithFallback never rejects.
    return safeFallback(ctx, 'PROVIDER_ERROR', elapsed(), err)
  }
}
