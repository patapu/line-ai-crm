import type { SuggestionView } from '@/modules/copilot/service'

// [E] components/copilot/insight-panel-helpers.ts: lane owned, pure. No
// React, no server imports (this file also has to be importable from a
// colocated test with no DOM tooling, see docs/design.md section 9 / the S4
// plan's G8). `import type` only from ./service: at runtime this module
// pulls in nothing from the copilot/db stack, only shapes.

export type NextBestAction = NonNullable<SuggestionView['nextBestAction']>

export const PENDING_LABEL = 'AI suggestion, not yet saved to the lead'

export const NBA_LABELS: Record<NextBestAction['type'], string> = {
  REPLY_LINE: 'Reply on LINE',
  CALL: 'Call the customer',
  SEND_PROPOSAL: 'Send a proposal',
  SCHEDULE_MEETING: 'Schedule a meeting',
  FOLLOW_UP_LATER: 'Follow up later',
  MOVE_STAGE: 'Move to the next stage',
  HANDOFF_TO_HUMAN: 'Hand off to a human',
  CLOSE_LOST: 'Close as lost',
}

/** Short badge labels for a suggestion's provenance and confidence. */
export function getSuggestionBadges(s: SuggestionView): string[] {
  const badges: string[] = []
  if (s.source === 'FALLBACK') badges.push('Fallback (rule-based)')
  if (s.lowConfidence) badges.push('Low confidence')
  if (s.errorCode === 'GUARDRAIL_BLOCKED') badges.push('Draft replaced by guardrail')
  return badges
}

/** The newest PENDING suggestion in a history list (any order), or null when there is none. */
export function pickCurrentSuggestion(items: SuggestionView[]): SuggestionView | null {
  return items.reduce<SuggestionView | null>((latest, item) => {
    if (item.status !== 'PENDING') return latest
    if (!latest || Date.parse(item.createdAt) > Date.parse(latest.createdAt)) return item
    return latest
  }, null)
}

/** Compares the current draft against the suggestion's original draft, trimmed on both sides. */
export function isDraftEdited(original: string | null, draft: string): boolean {
  return draft.trim() !== (original ?? '').trim()
}

/**
 * Mirrors the service's own `edited` rule: `replyText` is only sent when the
 * draft is non-empty. If the user clears the draft entirely and approves
 * with send:false, `replyText` is omitted here and the service keeps the
 * original AI draft on the row with `edited:false`: "edited" tracks whether
 * the text actually *sent* differs from the draft, not whether the textarea
 * was touched.
 */
export function buildApprovePayload(input: {
  send: boolean
  applyScore: boolean
  draft: string
}): { send: boolean; applyScore: boolean; replyText?: string } {
  const trimmed = input.draft.trim()
  return { send: input.send, applyScore: input.applyScore, ...(trimmed ? { replyText: trimmed } : {}) }
}

/**
 * Whether the Approve button should be enabled, given the panel's current
 * form state. `status` is optional so callers that only care about the rest
 * of the form (and existing callers/tests written before a decision could
 * be re-approved) keep working; when provided, anything other than
 * `'PENDING'` disables the button, since a decided/superseded suggestion
 * can no longer be approved.
 */
export function canSubmitApprove(input: {
  canApprove: boolean
  busy: boolean
  send: boolean
  hasLine: boolean
  draft: string
  status?: SuggestionView['status']
}): boolean {
  if (!input.canApprove || input.busy) return false
  if (input.status !== undefined && input.status !== 'PENDING') return false
  if (input.send && (!input.hasLine || input.draft.trim() === '')) return false
  return true
}

/** Whether the Reject button should be enabled. Same `status` rule as canSubmitApprove. */
export function canSubmitReject(input: {
  canApprove: boolean
  busy: boolean
  status?: SuggestionView['status']
}): boolean {
  if (!input.canApprove || input.busy) return false
  if (input.status !== undefined && input.status !== 'PENDING') return false
  return true
}

/** Turns an API error response into a user-facing message. 409 gets a specific hint; everything else falls back to the server's own message. */
export function describeApiError(status: number, body: unknown): string {
  if (status === 409) return 'This suggestion was already decided or replaced. Refresh to see the latest.'
  const message = (body as { error?: { message?: string } } | null)?.error?.message
  return message ?? 'Something went wrong'
}

/**
 * `res.ok` but the parsed body is null (an empty 200/204 body, or a body
 * `parseJsonSafely` had to give up on): every success handler in
 * InsightPanel.tsx reads a property off this body immediately, and doing
 * that on `null` throws a raw, unfriendly "Cannot read properties of null"
 * TypeError. Guarding here turns that into the same generic message
 * describeApiError's own fallback already uses for an error response with no
 * message. Moved here (from InsightPanel.tsx) so it can be unit tested
 * without any DOM tooling, same as every other helper in this file.
 */
export function requireBody(body: unknown, ...requiredKeys: string[]): asserts body is Record<string, unknown> {
  if (body === null || typeof body !== 'object') throw new Error('Something went wrong')
  const record = body as Record<string, unknown>
  for (const key of requiredKeys) {
    if (record[key] === undefined || record[key] === null) throw new Error('Something went wrong')
  }
}

/** Human-readable next-best-action due date. */
export function formatDue(dueInDays: number | null): string {
  if (dueInDays === null) return 'No due date'
  if (dueInDays === 0) return 'Due today'
  if (dueInDays === 1) return 'Due in 1 day'
  return `Due in ${dueInDays} days`
}
