import type { ApprovedMessageView, SuggestionView } from '@/modules/copilot/service'
import type { BadgeTone } from '@/components/ui/Badge'

// [B] components/copilot/insight-panel-helpers.ts: lane owned, pure. No
// React, no server imports (this file also has to be importable from a
// colocated test with no DOM tooling, see docs/design.md section 9 / the S4
// plan's G8). `import type` only from ./service and ui/Badge: at runtime
// this module pulls in nothing from the copilot/db stack or the component
// tree, only shapes.

export type NextBestAction = NonNullable<SuggestionView['nextBestAction']>
export type SuggestionStatus = SuggestionView['status']
export type SuggestionSource = SuggestionView['source']
export type MessageStatus = ApprovedMessageView['status']
export type LocaleOption = { value: 'auto' | 'th' | 'en'; label: string }
export type SuggestionBadgeItem = {
  id: 'FALLBACK' | 'LOW_CONFIDENCE' | 'GUARDRAIL_BLOCKED'
  label: string
  tone: BadgeTone
}

export const DRAFT_MAX = 1000
export const REJECT_REASON_MAX = 500

// Thai copy deck. English CRM words (lead, stage, LINE) stay English inside
// Thai sentences, per docs/design.md and the S1 InsightPanel redesign spec.
export const PANEL_TITLE = 'ผู้ช่วย AI'
export const LOCALE_LABEL = 'ภาษาของร่างข้อความ'
export const ASK_AI_LABEL = 'ขอคำแนะนำจาก AI'
export const ASK_AI_BUSY_LABEL = 'กำลังขอคำแนะนำ...'
export const LOADING_LABEL = 'กำลังโหลดคำแนะนำ...'
export const REQUESTING_STATUS = 'AI กำลังวิเคราะห์ lead นี้ อาจใช้เวลาสักครู่'
export const IDLE_TEXT = 'ยังไม่มีคำแนะนำที่รอตัดสินใจ กด "ขอคำแนะนำจาก AI" เพื่อวิเคราะห์ lead นี้จากข้อมูลล่าสุด'
export const CURRENT_HEADING = 'คำแนะนำปัจจุบัน'
export const PENDING_LABEL = 'คำแนะนำจาก AI ยังไม่ถูกบันทึกลง lead จนกว่าคุณจะอนุมัติ'
export const DECIDED_NOTE = 'คำแนะนำนี้ตัดสินใจแล้ว แก้ไขไม่ได้ กด "ขอคำแนะนำจาก AI" หากต้องการคำแนะนำใหม่'
export const BADGE_FALLBACK = 'ใช้กฎสำรอง (ไม่ได้ใช้โมเดล AI)'
export const BADGE_LOW_CONFIDENCE = 'ความมั่นใจต่ำ'
export const BADGE_GUARDRAIL = 'ร่างข้อความถูกแทนที่โดยระบบป้องกัน'
export const FLAGS_LABEL = 'ข้อควรระวัง'
export const SCORE_LABEL = 'คะแนนที่ AI ประเมิน'
export const SCORE_REASONS_LABEL = 'เหตุผลของคะแนน'
export const SUMMARY_LABEL = 'สรุป'
export const NBA_HEADING = 'สิ่งที่ควรทำต่อ'
export const DRAFT_LABEL = 'ร่างข้อความตอบกลับ'
export const DRAFT_EDITED_NOTE = 'แก้ไขจากร่างของ AI แล้ว'
export const DECISION_OPTIONS_LEGEND = 'ตัวเลือกเมื่ออนุมัติ'
export const SEND_LINE_LABEL = 'ส่งข้อความนี้ทาง LINE'
export const NO_LINE_HINT = 'ส่งทาง LINE ไม่ได้: ผู้ติดต่อนี้ยังไม่ได้เชื่อมต่อ LINE'
export const SEND_NEEDS_DRAFT_HINT = 'ใส่ร่างข้อความก่อน จึงจะส่งทาง LINE ได้'
export const APPLY_SCORE_LABEL = 'ใช้คะแนนนี้กับ lead'
export const NO_PERMISSION_NOTE = 'เฉพาะเจ้าของ lead หรือผู้ดูแลระบบเท่านั้นที่อนุมัติหรือปฏิเสธคำแนะนำได้'
export const APPROVE_LABEL = 'อนุมัติคำแนะนำ'
export const APPROVE_AND_SEND_LABEL = 'อนุมัติและส่งทาง LINE'
export const APPROVED_OUTCOME = 'อนุมัติคำแนะนำแล้ว'
export const REJECT_REASON_LABEL = 'เหตุผลที่ปฏิเสธ (ไม่บังคับ)'
export const REJECT_LABEL = 'ปฏิเสธคำแนะนำ'
export const REJECTED_OUTCOME = 'ปฏิเสธคำแนะนำแล้ว'
export const HISTORY_HEADING = 'ประวัติคำแนะนำ'
export const HISTORY_EMPTY = 'ยังไม่มีคำแนะนำสำหรับ lead นี้ กด "ขอคำแนะนำจาก AI" เพื่อเริ่ม'
export const ERROR_CONFLICT = 'คำแนะนำนี้ถูกตัดสินใจหรือถูกแทนที่ไปแล้ว รีเฟรชหน้าเพื่อดูข้อมูลล่าสุด'
export const ERROR_FORBIDDEN = 'คุณไม่มีสิทธิ์ทำรายการนี้กับ lead นี้'
export const ERROR_GENERIC = 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง หากยังไม่ได้ ให้รีเฟรชหน้า'

export const LOCALE_OPTIONS: LocaleOption[] = [
  { value: 'auto', label: 'อัตโนมัติ' },
  { value: 'th', label: 'ภาษาไทย' },
  { value: 'en', label: 'ภาษาอังกฤษ' },
]

export const NBA_LABELS: Record<NextBestAction['type'], string> = {
  REPLY_LINE: 'ตอบกลับทาง LINE',
  CALL: 'โทรหาลูกค้า',
  SEND_PROPOSAL: 'ส่งใบเสนอราคา',
  SCHEDULE_MEETING: 'นัดประชุม',
  FOLLOW_UP_LATER: 'ติดตามภายหลัง',
  MOVE_STAGE: 'เลื่อนไป stage ถัดไป',
  HANDOFF_TO_HUMAN: 'ส่งต่อให้พนักงานดูแล',
  CLOSE_LOST: 'ปิดเป็นปิดการขายไม่สำเร็จ',
}

export const SUGGESTION_STATUS_LABEL: Record<SuggestionStatus, string> = {
  PENDING: 'รอตัดสินใจ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ปฏิเสธแล้ว',
  SUPERSEDED: 'ถูกแทนที่',
}

export const SUGGESTION_STATUS_TONE: Record<SuggestionStatus, BadgeTone> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
  SUPERSEDED: 'gray',
}

export const SUGGESTION_SOURCE_LABEL: Record<SuggestionSource, string> = {
  MODEL: 'โมเดล AI',
  FALLBACK: 'กฎสำรอง',
}

/**
 * `ApprovedMessageView['status']` mirrors the full `Message['status']` enum
 * (schema.prisma's MessageStatus), but the approve flow only ever produces
 * QUEUED, SENT, or FAILED (and RECEIVED on a post-failure re-fetch); LOGGED
 * is never set by this flow. Kept as a full, exhaustive Record rather than a
 * partial one, so `MESSAGE_STATUS_TEXT[lastMessage.status]` never needs an
 * `undefined` check; LOGGED reuses RECEIVED's copy since both describe a
 * message that was only recorded, with nothing further to report.
 */
export const MESSAGE_STATUS_TEXT: Record<MessageStatus, string> = {
  SENT: 'ส่งข้อความทาง LINE แล้ว',
  QUEUED: 'ข้อความอยู่ในคิวรอส่งทาง LINE หากยังไม่ถูกส่ง ลองส่งใหม่ได้จาก Timeline ของ lead นี้',
  FAILED: 'ส่งข้อความทาง LINE ไม่สำเร็จ ลองส่งใหม่ได้จาก Timeline ของ lead นี้',
  RECEIVED: 'บันทึกข้อความแล้ว',
  LOGGED: 'บันทึกข้อความแล้ว',
}

/** Badge items for a suggestion's provenance and confidence, in a fixed display order. */
export function getSuggestionBadgeItems(s: SuggestionView): SuggestionBadgeItem[] {
  const items: SuggestionBadgeItem[] = []
  if (s.source === 'FALLBACK') items.push({ id: 'FALLBACK', label: BADGE_FALLBACK, tone: 'gray' })
  if (s.lowConfidence) items.push({ id: 'LOW_CONFIDENCE', label: BADGE_LOW_CONFIDENCE, tone: 'amber' })
  if (s.errorCode === 'GUARDRAIL_BLOCKED') items.push({ id: 'GUARDRAIL_BLOCKED', label: BADGE_GUARDRAIL, tone: 'violet' })
  return items
}

/** Short badge labels for a suggestion's provenance and confidence, derived from getSuggestionBadgeItems. */
export function getSuggestionBadges(s: SuggestionView): string[] {
  return getSuggestionBadgeItems(s).map((item) => item.label)
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

/** Turns an API error response into a user-facing message. 409 and 403 get a specific Thai message; everything else falls back to the server's own message, then ERROR_GENERIC. */
export function describeApiError(status: number, body: unknown): string {
  if (status === 409) return ERROR_CONFLICT
  if (status === 403) return ERROR_FORBIDDEN
  const message = (body as { error?: { message?: string } } | null)?.error?.message
  return message ?? ERROR_GENERIC
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
  if (body === null || typeof body !== 'object') throw new Error(ERROR_GENERIC)
  const record = body as Record<string, unknown>
  for (const key of requiredKeys) {
    if (record[key] === undefined || record[key] === null) throw new Error(ERROR_GENERIC)
  }
}

/** Human-readable next-best-action due date. */
export function formatDue(dueInDays: number | null): string {
  if (dueInDays === null) return 'ไม่มีกำหนดเวลา'
  if (dueInDays === 0) return 'ควรทำภายในวันนี้'
  return `ควรทำภายใน ${dueInDays} วัน`
}

/** Character counter under the draft textarea, e.g. "42/1000 ตัวอักษร". */
export function formatDraftCount(length: number): string {
  return `${length}/${DRAFT_MAX} ตัวอักษร`
}

/** Score label for one history row, e.g. "คะแนน 70". */
export function formatHistoryScore(score: number): string {
  return `คะแนน ${score}`
}

/** Thrown by the panel's fetch helpers for any non-OK response, so a catch block can branch on `status` (401 -> redirect to login) without re-parsing the response. */
export class InsightRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'InsightRequestError'
  }
}

/**
 * Mirrors components/crm/auth-redirect.ts's redirect format exactly
 * (`/login?next=<encoded current pathname + search>`), without importing
 * it: that helper is Lane A's, reads `window.location` itself, and is typed
 * around Lane A's `ApiError`. This is a pure function so the panel's caller
 * reads `window.location` once and this stays unit-testable with plain
 * strings. Returns null when already on `/login`, so a 401 there never
 * loops back into itself.
 */
export function buildLoginRedirect(pathname: string, search: string): string | null {
  if (pathname === '/login') return null
  return `/login?next=${encodeURIComponent(`${pathname}${search}`)}`
}

/**
 * Pure decision for a catch block: whether `err` is a 401 from the panel's
 * own fetch helpers, and if so, where to redirect. Returns null both when
 * `err` is not an unauthorized InsightRequestError and when it is but
 * buildLoginRedirect finds no real destination (already on `/login`), so
 * either way the caller falls through to its normal error handling instead
 * of navigating.
 */
export function loginRedirectFor(err: unknown, pathname: string, search: string): string | null {
  if (!(err instanceof InsightRequestError) || err.status !== 401) return null
  return buildLoginRedirect(pathname, search)
}
