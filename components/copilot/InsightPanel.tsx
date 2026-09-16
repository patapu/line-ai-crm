'use client'

// OWNER: lane B
//
// Props contract frozen per docs/design.md section 1:
// `components/copilot/InsightPanel.tsx [B] props [F]: { leadId: string; canApprove: boolean }`
// Layer 0 only froze the export name and prop shape so app/(app)/leads/[id]/page.tsx
// (Lane A) can mount this component before Lane B implemented it; this file
// fills in the body.
//
// Every fetch runs from an event handler (Ask AI / Approve / Reject) except
// the initial history load, which runs from the mount effect below. That
// effect only ever calls setState from inside a `.then`/`.catch` callback,
// guarded by a `cancelled` flag, never synchronously in the effect body
// itself (react-hooks/set-state-in-effect). The focus-management effect
// further down never calls a state setter at all: it only reads a plain
// ref and imperatively calls `.focus()`, so it never trips that rule either.

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useRouter } from 'next/navigation'
import type { ApprovedMessageView, SuggestionView } from '@/modules/copilot/service'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { formatDateTime } from '@/components/ui/format'
import {
  APPLY_SCORE_LABEL,
  APPROVED_OUTCOME,
  APPROVE_AND_SEND_LABEL,
  APPROVE_LABEL,
  ASK_AI_BUSY_LABEL,
  ASK_AI_LABEL,
  CURRENT_HEADING,
  DECIDED_NOTE,
  DECISION_OPTIONS_LEGEND,
  DRAFT_EDITED_NOTE,
  DRAFT_LABEL,
  DRAFT_MAX,
  ERROR_GENERIC,
  FLAGS_LABEL,
  HISTORY_EMPTY,
  HISTORY_HEADING,
  IDLE_TEXT,
  InsightRequestError,
  LOADING_LABEL,
  LOCALE_LABEL,
  LOCALE_OPTIONS,
  MESSAGE_STATUS_TEXT,
  NBA_HEADING,
  NBA_LABELS,
  NO_LINE_HINT,
  NO_PERMISSION_NOTE,
  PANEL_TITLE,
  PENDING_LABEL,
  REJECTED_OUTCOME,
  REJECT_LABEL,
  REJECT_REASON_LABEL,
  REJECT_REASON_MAX,
  REQUESTING_STATUS,
  SCORE_LABEL,
  SCORE_REASONS_LABEL,
  SEND_LINE_LABEL,
  SEND_NEEDS_DRAFT_HINT,
  SUGGESTION_SOURCE_LABEL,
  SUGGESTION_STATUS_LABEL,
  SUGGESTION_STATUS_TONE,
  SUMMARY_LABEL,
  buildApprovePayload,
  canSubmitApprove,
  canSubmitReject,
  describeApiError,
  formatDraftCount,
  formatDue,
  formatHistoryScore,
  getSuggestionBadgeItems,
  isDraftEdited,
  loginRedirectFor,
  pickCurrentSuggestion,
  pendingToApplyOnActionFailure,
  planMountLoad,
  requireBody,
  type SuggestionBadgeItem,
} from './insight-panel-helpers'

export interface InsightPanelProps {
  leadId: string
  canApprove: boolean
}

type Phase = 'loading' | 'idle' | 'requesting' | 'result' | 'error'
type Locale = 'auto' | 'th' | 'en'
type ErrorScope = 'load' | 'ask' | 'decide' | null
type Outcome = 'APPROVED' | 'REJECTED' | null

interface HistoryResult {
  items: SuggestionView[]
  hasLine: boolean
}

/**
 * `res.json()` throws on a non-JSON body (e.g. a 502/504 from an upstream
 * proxy returning an HTML error page): parsed defensively so a bad error
 * response still produces a normal, describeApiError-friendly failure
 * instead of an unrelated "Unexpected token" thrown from here.
 */
async function parseJsonSafely(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

async function fetchHistory(leadId: string): Promise<HistoryResult> {
  const res = await fetch(`/api/leads/${leadId}/suggestions?limit=10`)
  const body = await parseJsonSafely(res)
  if (!res.ok) throw new InsightRequestError(res.status, describeApiError(res.status, body))
  requireBody(body, 'items')
  // n4 (S21 pass 4): requireBody only checks the key is present, not that
  // it's the array shape this component always renders with `.map`; a
  // malformed body (e.g. `items` sent back as an object) must surface the
  // same friendly error instead of throwing an unrelated "items.map is not a
  // function" out of the render.
  if (!Array.isArray((body as { items: unknown }).items)) throw new Error(ERROR_GENERIC)
  return { items: (body as { items: SuggestionView[] }).items, hasLine: Boolean((body as { hasLine?: boolean }).hasLine) }
}

/**
 * On a 401, sends the user to `/login?next=<here>` and reports `true` so the
 * caller's catch block returns early with no error banner and no error
 * phase (spec: 401 anywhere is a silent redirect, never a visible error).
 * Any other error, or a 401 while somehow already on `/login`, reports
 * `false` so the caller falls through to its normal error handling. The
 * status/destination decision itself lives in the pure, unit-testable
 * loginRedirectFor; this wrapper only reads window.location and calls the
 * router.
 */
function redirectOnUnauthorized(err: unknown, router: ReturnType<typeof useRouter>): boolean {
  const path = loginRedirectFor(err, window.location.pathname, window.location.search)
  if (path === null) return false
  router.replace(path)
  return true
}

export function InsightPanel({ leadId, canApprove }: InsightPanelProps) {
  const router = useRouter()

  const [phase, setPhase] = useState<Phase>('loading')
  const [current, setCurrent] = useState<SuggestionView | null>(null)
  const [history, setHistory] = useState<SuggestionView[]>([])
  const [hasLine, setHasLine] = useState(false)
  const [draft, setDraft] = useState('')
  const [send, setSend] = useState(false)
  const [applyScore, setApplyScore] = useState(false)
  const [reason, setReason] = useState('')
  const [locale, setLocale] = useState<Locale>('auto')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorScope, setErrorScope] = useState<ErrorScope>(null)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [lastMessage, setLastMessage] = useState<ApprovedMessageView | null>(null)

  const currentHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const outcomeRef = useRef<HTMLDivElement | null>(null)
  // Mutable, not state: a pending focus target set synchronously inside an
  // event handler and consumed by the effect below right after the render it
  // caused. Using a ref (rather than state) here means that effect never
  // calls a state setter, so it can never trip react-hooks/set-state-in-effect.
  const pendingFocusRef = useRef<'current' | 'outcome' | null>(null)
  // True only while an Ask AI / Approve / Reject fetch is pending, flipped
  // back to false in that action's own `finally` (success or failure alike).
  // While true, the mount history load's `.then` below must not touch
  // current/draft/outcome/phase itself (that could stomp on 'requesting' or
  // race the action's own result); it stashes its pick into
  // stashedPendingRef instead. Transient by design: unlike actionCommittedRef
  // below, this never sticks, so a later mount-load resolution is never
  // blocked just because *some* action ran and finished.
  const actionInFlightRef = useRef(false)
  // Set once Ask AI, Approve or Reject *successfully* commits a new
  // current/draft/outcome/phase. Sticky for the rest of this mount: once an
  // action has established the source of truth for those fields, the mount
  // load's `.then` must never overwrite them again, no matter how late it
  // resolves. A failed action does NOT set this, which is what lets a
  // still-pending mount load (or its stash) apply instead.
  const actionCommittedRef = useRef(false)
  // Set by the mount load's `.then` when it resolves while an action is in
  // flight (see planMountLoad's 'stash' outcome): the pending suggestion it
  // would have shown, held here until that action finishes. Consumed by
  // pendingToApplyOnActionFailure in the action's own catch block, only when
  // the action failed and never set `current` itself; a successful action
  // ignores it (actionCommittedRef already covers that case).
  const stashedPendingRef = useRef<SuggestionView | null>(null)
  // Bumped by a successful refreshHistory() call. Once true, the mount
  // load's `.then` must skip setHistory/setHasLine even if it resolves after
  // refreshHistory: otherwise a slow initial fetch can land after a
  // newer, already-rendered list and silently roll it back.
  const historyRefreshedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    // Ref-only reset for the new leadId: no setState here, so this can never
    // trip react-hooks/set-state-in-effect. Each of these refs tracks state
    // for the *current* mount only; a leadId change starts a fresh one.
    actionInFlightRef.current = false
    actionCommittedRef.current = false
    stashedPendingRef.current = null
    historyRefreshedRef.current = false

    fetchHistory(leadId)
      .then((result) => {
        if (cancelled) return
        const plan = planMountLoad({
          historyRefreshed: historyRefreshedRef.current,
          actionCommitted: actionCommittedRef.current,
          actionInFlight: actionInFlightRef.current,
        })
        if (plan.applyHistory) {
          setHistory(result.items)
          setHasLine(result.hasLine)
          if (!result.hasLine) setSend(false)
        }
        const pending = pickCurrentSuggestion(result.items)
        if (plan.current === 'apply') {
          setCurrent(pending)
          setDraft(pending?.draftReply ?? '')
          setOutcome(null)
          setPhase(pending ? 'result' : 'idle')
        } else if (plan.current === 'stash') {
          stashedPendingRef.current = pending
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (redirectOnUnauthorized(err, router)) return
        setError(err instanceof Error ? err.message : ERROR_GENERIC)
        setErrorScope('load')
        setPhase('error')
      })

    return () => {
      cancelled = true
    }
  }, [leadId, router])

  // Focuses whichever element the last successful action asked for, once
  // that action's render has committed. Runs after every render (no
  // dependency array) but is a no-op unless a handler just set the ref.
  useEffect(() => {
    if (pendingFocusRef.current === 'current') {
      currentHeadingRef.current?.focus()
    } else if (pendingFocusRef.current === 'outcome') {
      outcomeRef.current?.focus()
    }
    pendingFocusRef.current = null
  })

  async function refreshHistory(): Promise<void> {
    try {
      const result = await fetchHistory(leadId)
      historyRefreshedRef.current = true
      setHistory(result.items)
      setHasLine(result.hasLine)
      if (!result.hasLine) setSend(false)
    } catch {
      // History is a convenience view; a failed refetch here keeps whatever
      // the last successful response left in state, instead of stacking a
      // second error banner on top of an approve/reject result that already
      // succeeded.
    }
  }

  async function handleAskAi(): Promise<void> {
    actionInFlightRef.current = true
    setBusy(true)
    setError(null)
    setErrorScope(null)
    setPhase('requesting')
    let redirected = false
    try {
      const res = await fetch(`/api/leads/${leadId}/insights`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(locale === 'auto' ? {} : { replyLocale: locale }),
      })
      const body = await parseJsonSafely(res)
      if (!res.ok) throw new InsightRequestError(res.status, describeApiError(res.status, body))
      requireBody(body, 'suggestion')

      const suggestion = (body as { suggestion: SuggestionView }).suggestion
      actionCommittedRef.current = true
      setCurrent(suggestion)
      setDraft(suggestion.draftReply ?? '')
      setSend(false)
      setApplyScore(false)
      setReason('')
      setLastMessage(null)
      setOutcome(null)
      setPhase('result')
      pendingFocusRef.current = 'current'
      await refreshHistory()
      router.refresh()
    } catch (err) {
      if (redirectOnUnauthorized(err, router)) {
        // Keep the UI busy (phase stays 'requesting', Ask AI stays
        // aria-disabled) all the way through navigation, instead of letting
        // `finally` clear busy and leave a clickable "busy" button behind
        // while router.replace is still in flight.
        redirected = true
        return
      }
      setError(err instanceof Error ? err.message : ERROR_GENERIC)
      setErrorScope('ask')
      setPhase('error')
      // If the mount load resolved while this request was in flight, it
      // stashed its pending pick instead of applying it (planMountLoad's
      // 'stash' outcome). Now that this action has failed without ever
      // setting `current` itself, apply that stash so an existing PENDING
      // suggestion is not hidden behind IDLE_TEXT until some later success.
      const stashed = pendingToApplyOnActionFailure({ current, stashed: stashedPendingRef.current })
      if (stashed) {
        setCurrent(stashed)
        setDraft(stashed.draftReply ?? '')
        setOutcome(null)
        stashedPendingRef.current = null
      }
    } finally {
      actionInFlightRef.current = false
      if (!redirected) setBusy(false)
    }
  }

  async function handleApprove(): Promise<void> {
    if (!current) return
    actionInFlightRef.current = true
    setBusy(true)
    setError(null)
    setErrorScope(null)
    let redirected = false
    try {
      const res = await fetch(`/api/suggestions/${current.id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildApprovePayload({ send, applyScore, draft })),
      })
      const body = await parseJsonSafely(res)
      if (!res.ok) throw new InsightRequestError(res.status, describeApiError(res.status, body))
      requireBody(body, 'suggestion')

      const approveBody = body as { suggestion: SuggestionView; message: ApprovedMessageView | null }
      actionCommittedRef.current = true
      setCurrent(approveBody.suggestion)
      setLastMessage(approveBody.message ?? null)
      setOutcome('APPROVED')
      pendingFocusRef.current = 'outcome'
      await refreshHistory()
      router.refresh()
    } catch (err) {
      if (redirectOnUnauthorized(err, router)) {
        redirected = true
        return
      }
      setError(err instanceof Error ? err.message : ERROR_GENERIC)
      setErrorScope('decide')
      // See handleAskAi: current can only be null here if the lead had no
      // PENDING suggestion when this render's `current` closure was formed,
      // which canSubmitApprove already prevents, so this is a no-op for
      // Approve/Reject today, kept for symmetry and to stay correct if that
      // guard ever loosens.
      const stashed = pendingToApplyOnActionFailure({ current, stashed: stashedPendingRef.current })
      if (stashed) {
        setCurrent(stashed)
        setDraft(stashed.draftReply ?? '')
        setOutcome(null)
        stashedPendingRef.current = null
      }
    } finally {
      actionInFlightRef.current = false
      if (!redirected) setBusy(false)
    }
  }

  async function handleReject(): Promise<void> {
    if (!current) return
    actionInFlightRef.current = true
    setBusy(true)
    setError(null)
    setErrorScope(null)
    let redirected = false
    try {
      const trimmedReason = reason.trim()
      const res = await fetch(`/api/suggestions/${current.id}/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(trimmedReason ? { reason: trimmedReason } : {}),
      })
      const body = await parseJsonSafely(res)
      if (!res.ok) throw new InsightRequestError(res.status, describeApiError(res.status, body))
      requireBody(body, 'suggestion')

      actionCommittedRef.current = true
      setCurrent((body as { suggestion: SuggestionView }).suggestion)
      setReason('')
      setLastMessage(null)
      setOutcome('REJECTED')
      pendingFocusRef.current = 'outcome'
      await refreshHistory()
      router.refresh()
    } catch (err) {
      if (redirectOnUnauthorized(err, router)) {
        redirected = true
        return
      }
      setError(err instanceof Error ? err.message : ERROR_GENERIC)
      setErrorScope('decide')
      // See handleApprove: a no-op today (current can't be null when Reject
      // runs), kept for symmetry with handleAskAi and future-proofing.
      const stashed = pendingToApplyOnActionFailure({ current, stashed: stashedPendingRef.current })
      if (stashed) {
        setCurrent(stashed)
        setDraft(stashed.draftReply ?? '')
        setOutcome(null)
        stashedPendingRef.current = null
      }
    } finally {
      actionInFlightRef.current = false
      if (!redirected) setBusy(false)
    }
  }

  const approveDisabled = !canSubmitApprove({ canApprove, busy, send, hasLine, draft, status: current?.status })
  const rejectDisabled = !canSubmitReject({ canApprove, busy, status: current?.status })

  return (
    <Card role="region" aria-labelledby="insight-panel-title" aria-busy={busy} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <h2 id="insight-panel-title" className="text-sm font-semibold text-slate-900">
          {PANEL_TITLE}
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label={LOCALE_LABEL} htmlFor="insight-panel-locale">
            <Select
              id="insight-panel-locale"
              value={locale}
              disabled={phase === 'requesting'}
              onChange={(e) => setLocale(e.target.value as Locale)}
            >
              {LOCALE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            type="button"
            size="sm"
            variant="primary"
            aria-disabled={busy}
            className="w-full sm:w-auto aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-slate-900"
            onClick={() => {
              if (busy) return
              handleAskAi()
            }}
          >
            {phase === 'requesting' ? ASK_AI_BUSY_LABEL : ASK_AI_LABEL}
          </Button>
        </div>
        <p role="status" className="min-h-5 text-xs text-slate-600">
          {phase === 'loading' ? LOADING_LABEL : phase === 'requesting' ? REQUESTING_STATUS : ''}
        </p>
        {(errorScope === 'load' || errorScope === 'ask') && error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>

      {!current && phase !== 'loading' && errorScope !== 'load' && <p className="text-sm text-slate-600">{IDLE_TEXT}</p>}

      {current && (
        <SuggestionSection
          current={current}
          canApprove={canApprove}
          hasLine={hasLine}
          busy={busy}
          draft={draft}
          onDraftChange={setDraft}
          send={send}
          onSendChange={setSend}
          applyScore={applyScore}
          onApplyScoreChange={setApplyScore}
          reason={reason}
          onReasonChange={setReason}
          errorScope={errorScope}
          error={error}
          outcome={outcome}
          lastMessage={lastMessage}
          approveDisabled={approveDisabled}
          rejectDisabled={rejectDisabled}
          onApprove={handleApprove}
          onReject={handleReject}
          headingRef={currentHeadingRef}
          outcomeRef={outcomeRef}
        />
      )}

      <HistorySection history={history} loading={phase === 'loading'} />
    </Card>
  )
}

function SuggestionSection({
  current,
  canApprove,
  hasLine,
  busy,
  draft,
  onDraftChange,
  send,
  onSendChange,
  applyScore,
  onApplyScoreChange,
  reason,
  onReasonChange,
  errorScope,
  error,
  outcome,
  lastMessage,
  approveDisabled,
  rejectDisabled,
  onApprove,
  onReject,
  headingRef,
  outcomeRef,
}: {
  current: SuggestionView
  canApprove: boolean
  hasLine: boolean
  busy: boolean
  draft: string
  onDraftChange: (value: string) => void
  send: boolean
  onSendChange: (value: boolean) => void
  applyScore: boolean
  onApplyScoreChange: (value: boolean) => void
  reason: string
  onReasonChange: (value: string) => void
  errorScope: ErrorScope
  error: string | null
  outcome: Outcome
  lastMessage: ApprovedMessageView | null
  approveDisabled: boolean
  rejectDisabled: boolean
  onApprove: () => void
  onReject: () => void
  headingRef: RefObject<HTMLHeadingElement | null>
  outcomeRef: RefObject<HTMLDivElement | null>
}) {
  const badgeItems: SuggestionBadgeItem[] = getSuggestionBadgeItems(current)
  const notPending = current.status !== 'PENDING'
  const edited = isDraftEdited(current.draftReply, draft)
  const formDisabled = !canApprove || notPending || busy
  const sendHint = !hasLine ? NO_LINE_HINT : send && draft.trim() === '' ? SEND_NEEDS_DRAFT_HINT : null

  return (
    <section aria-labelledby="insight-panel-current" className="flex flex-col gap-3 border-t border-slate-200 pt-4">
      <div className="flex items-center gap-2">
        <h3
          id="insight-panel-current"
          tabIndex={-1}
          ref={headingRef}
          className="text-sm font-semibold text-slate-900 focus:outline-none"
        >
          {CURRENT_HEADING}
        </h3>
        <Badge tone={SUGGESTION_STATUS_TONE[current.status]}>{SUGGESTION_STATUS_LABEL[current.status]}</Badge>
      </div>

      <p className="text-xs text-slate-600">{current.status === 'PENDING' ? PENDING_LABEL : DECIDED_NOTE}</p>

      {badgeItems.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {badgeItems.map((item) => (
            <li key={item.id}>
              <Badge tone={item.tone}>{item.label}</Badge>
            </li>
          ))}
        </ul>
      )}

      {current.flags.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-700">{FLAGS_LABEL}</span>
          <ul className="flex flex-wrap gap-2">
            {current.flags.map((flag, index) => (
              <li key={`${index}-${flag}`}>
                <Badge tone="amber">{flag}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="flex flex-col gap-2 text-sm">
        <dt className="text-slate-600">{SCORE_LABEL}</dt>
        <dd className="font-semibold text-slate-900">{current.score}</dd>
        <dt className="text-slate-600">{SCORE_REASONS_LABEL}</dt>
        <dd>
          <ul className="list-disc pl-5 text-slate-700">
            {current.scoreReasons.map((reasonText, index) => (
              <li key={`${index}-${reasonText}`}>{reasonText}</li>
            ))}
          </ul>
        </dd>
        <dt className="text-slate-600">{SUMMARY_LABEL}</dt>
        <dd className="leading-relaxed text-slate-700">{current.summary}</dd>
      </dl>

      {current.nextBestAction && (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold text-slate-700">{NBA_HEADING}</h4>
          <p className="font-medium text-slate-900">{NBA_LABELS[current.nextBestAction.type]}</p>
          <p className="text-slate-700">{current.nextBestAction.title}</p>
          <p className="text-slate-600">{current.nextBestAction.rationale}</p>
          <p className="text-xs text-slate-600">{formatDue(current.nextBestAction.dueInDays)}</p>
        </div>
      )}

      <DecisionControls
        draft={draft}
        onDraftChange={onDraftChange}
        edited={edited}
        formDisabled={formDisabled}
        hasLine={hasLine}
        send={send}
        onSendChange={onSendChange}
        applyScore={applyScore}
        onApplyScoreChange={onApplyScoreChange}
        sendHint={sendHint}
        canApprove={canApprove}
        approveDisabled={approveDisabled}
        approveLabel={send ? APPROVE_AND_SEND_LABEL : APPROVE_LABEL}
        onApprove={onApprove}
        errorScope={errorScope}
        error={error}
        outcome={outcome}
        lastMessage={lastMessage}
        outcomeRef={outcomeRef}
        reason={reason}
        onReasonChange={onReasonChange}
        rejectDisabled={rejectDisabled}
        onReject={onReject}
      />
    </section>
  )
}

function DecisionControls({
  draft,
  onDraftChange,
  edited,
  formDisabled,
  hasLine,
  send,
  onSendChange,
  applyScore,
  onApplyScoreChange,
  sendHint,
  canApprove,
  approveDisabled,
  approveLabel,
  onApprove,
  errorScope,
  error,
  outcome,
  lastMessage,
  outcomeRef,
  reason,
  onReasonChange,
  rejectDisabled,
  onReject,
}: {
  draft: string
  onDraftChange: (value: string) => void
  edited: boolean
  formDisabled: boolean
  hasLine: boolean
  send: boolean
  onSendChange: (value: boolean) => void
  applyScore: boolean
  onApplyScoreChange: (value: boolean) => void
  sendHint: string | null
  canApprove: boolean
  approveDisabled: boolean
  approveLabel: string
  onApprove: () => void
  errorScope: ErrorScope
  error: string | null
  outcome: Outcome
  lastMessage: ApprovedMessageView | null
  outcomeRef: RefObject<HTMLDivElement | null>
  reason: string
  onReasonChange: (value: string) => void
  rejectDisabled: boolean
  onReject: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <Field label={DRAFT_LABEL} htmlFor="insight-panel-draft">
        <Textarea
          id="insight-panel-draft"
          rows={4}
          maxLength={DRAFT_MAX}
          value={draft}
          disabled={formDisabled}
          aria-describedby="insight-panel-draft-meta"
          className="break-words"
          onChange={(e) => onDraftChange(e.target.value)}
        />
      </Field>
      <div id="insight-panel-draft-meta" className="flex justify-between text-xs text-slate-600">
        <span>{edited ? DRAFT_EDITED_NOTE : ''}</span>
        <span>{formatDraftCount(draft.length)}</span>
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="sr-only">{DECISION_OPTIONS_LEGEND}</legend>
        <label className="flex min-h-6 items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="size-4 accent-slate-900"
            checked={send}
            disabled={formDisabled || !hasLine}
            aria-describedby={sendHint ? 'insight-panel-send-hint' : undefined}
            onChange={(e) => onSendChange(e.target.checked)}
          />
          {SEND_LINE_LABEL}
        </label>
        {sendHint && (
          <p id="insight-panel-send-hint" className="text-xs text-slate-600">
            {sendHint}
          </p>
        )}
        <label className="flex min-h-6 items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="size-4 accent-slate-900"
            checked={applyScore}
            disabled={formDisabled}
            onChange={(e) => onApplyScoreChange(e.target.checked)}
          />
          {APPLY_SCORE_LABEL}
        </label>
      </fieldset>

      {!canApprove && <p className="text-xs text-slate-600">{NO_PERMISSION_NOTE}</p>}

      <Button
        type="button"
        size="sm"
        variant="primary"
        aria-disabled={approveDisabled}
        className="w-full sm:w-auto sm:self-start aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-slate-900"
        onClick={() => {
          if (approveDisabled) return
          onApprove()
        }}
      >
        {approveLabel}
      </Button>

      {errorScope === 'decide' && error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {outcome && (
        <div id="insight-panel-outcome" tabIndex={-1} ref={outcomeRef} className="text-sm text-slate-700 focus:outline-none">
          <p>{outcome === 'APPROVED' ? APPROVED_OUTCOME : REJECTED_OUTCOME}</p>
          {lastMessage && <p>{MESSAGE_STATUS_TEXT[lastMessage.status]}</p>}
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-dashed border-slate-200 pt-3">
        <Field label={REJECT_REASON_LABEL} htmlFor="insight-panel-reason">
          <Input
            id="insight-panel-reason"
            type="text"
            maxLength={REJECT_REASON_MAX}
            value={reason}
            disabled={formDisabled}
            onChange={(e) => onReasonChange(e.target.value)}
          />
        </Field>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-disabled={rejectDisabled}
          className="w-full sm:w-auto sm:self-start aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-white"
          onClick={() => {
            if (rejectDisabled) return
            onReject()
          }}
        >
          {REJECT_LABEL}
        </Button>
      </div>
    </div>
  )
}

function HistorySection({ history, loading }: { history: SuggestionView[]; loading: boolean }) {
  return (
    <section aria-labelledby="insight-panel-history" className="border-t border-slate-200 pt-4">
      <h3 id="insight-panel-history" className="text-sm font-semibold text-slate-900">
        {HISTORY_HEADING}
      </h3>
      {history.length === 0 && !loading && <p className="text-sm text-slate-600">{HISTORY_EMPTY}</p>}
      {history.length > 0 && (
        <ul className="divide-y divide-slate-200">
          {history.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-xs text-slate-600"
            >
              <span suppressHydrationWarning>{formatDateTime(item.createdAt)}</span>
              <Badge tone={SUGGESTION_STATUS_TONE[item.status]}>{SUGGESTION_STATUS_LABEL[item.status]}</Badge>
              <span>
                {SUGGESTION_SOURCE_LABEL[item.source]} · {formatHistoryScore(item.score)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
