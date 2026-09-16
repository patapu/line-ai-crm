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
// itself (react-hooks/set-state-in-effect).

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ApprovedMessageView, SuggestionView } from '@/modules/copilot/service'
import {
  NBA_LABELS,
  PENDING_LABEL,
  buildApprovePayload,
  canSubmitApprove,
  canSubmitReject,
  describeApiError,
  formatDue,
  getSuggestionBadges,
  isDraftEdited,
  pickCurrentSuggestion,
  requireBody,
} from './insight-panel-helpers'

export interface InsightPanelProps {
  leadId: string
  canApprove: boolean
}

type Phase = 'loading' | 'idle' | 'requesting' | 'result' | 'error'
type Locale = 'auto' | 'th' | 'en'

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
  if (!res.ok) throw new Error(describeApiError(res.status, body))
  requireBody(body, 'items')
  // n4 (S21 pass 4): requireBody only checks the key is present, not that
  // it's the array shape this component always renders with `.map`; a
  // malformed body (e.g. `items` sent back as an object) must surface the
  // same friendly error instead of throwing an unrelated "items.map is not a
  // function" out of the render.
  if (!Array.isArray((body as { items: unknown }).items)) throw new Error('Something went wrong')
  return { items: (body as { items: SuggestionView[] }).items, hasLine: Boolean((body as { hasLine?: boolean }).hasLine) }
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
  const [lastMessage, setLastMessage] = useState<ApprovedMessageView | null>(null)

  useEffect(() => {
    let cancelled = false

    fetchHistory(leadId)
      .then((result) => {
        if (cancelled) return
        const pending = pickCurrentSuggestion(result.items)
        setHistory(result.items)
        setHasLine(result.hasLine)
        setCurrent(pending)
        setDraft(pending?.draftReply ?? '')
        setPhase(pending ? 'result' : 'idle')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Something went wrong')
        setPhase('error')
      })

    return () => {
      cancelled = true
    }
  }, [leadId])

  async function refreshHistory(): Promise<void> {
    try {
      const result = await fetchHistory(leadId)
      setHistory(result.items)
      setHasLine(result.hasLine)
    } catch {
      // History is a convenience view; a failed refetch here keeps whatever
      // the last successful response left in state, instead of stacking a
      // second error banner on top of an approve/reject result that already
      // succeeded.
    }
  }

  async function handleAskAi(): Promise<void> {
    setBusy(true)
    setError(null)
    setPhase('requesting')
    try {
      const res = await fetch(`/api/leads/${leadId}/insights`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(locale === 'auto' ? {} : { replyLocale: locale }),
      })
      const body = await parseJsonSafely(res)
      if (!res.ok) throw new Error(describeApiError(res.status, body))
      requireBody(body, 'suggestion')

      const suggestion = (body as { suggestion: SuggestionView }).suggestion
      setCurrent(suggestion)
      setDraft(suggestion.draftReply ?? '')
      setSend(false)
      setApplyScore(false)
      setReason('')
      setLastMessage(null)
      setPhase('result')
      await refreshHistory()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setPhase('error')
    } finally {
      setBusy(false)
    }
  }

  async function handleApprove(): Promise<void> {
    if (!current) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/suggestions/${current.id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildApprovePayload({ send, applyScore, draft })),
      })
      const body = await parseJsonSafely(res)
      if (!res.ok) throw new Error(describeApiError(res.status, body))
      requireBody(body, 'suggestion')

      const approveBody = body as { suggestion: SuggestionView; message: ApprovedMessageView | null }
      setCurrent(approveBody.suggestion)
      setLastMessage(approveBody.message ?? null)
      await refreshHistory()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  async function handleReject(): Promise<void> {
    if (!current) return
    setBusy(true)
    setError(null)
    try {
      const trimmedReason = reason.trim()
      const res = await fetch(`/api/suggestions/${current.id}/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(trimmedReason ? { reason: trimmedReason } : {}),
      })
      const body = await parseJsonSafely(res)
      if (!res.ok) throw new Error(describeApiError(res.status, body))
      requireBody(body, 'suggestion')

      setCurrent((body as { suggestion: SuggestionView }).suggestion)
      setReason('')
      setLastMessage(null)
      await refreshHistory()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const badges = current ? getSuggestionBadges(current) : []
  const edited = current ? isDraftEdited(current.draftReply, draft) : false
  // A suggestion that already left PENDING (approved, rejected, or
  // superseded by a newer "Ask AI") is a fixed historical record: every
  // decision control below is locked once this is true.
  const notPending = current ? current.status !== 'PENDING' : false
  const approveDisabled = !canSubmitApprove({ canApprove, busy, send, hasLine, draft, status: current?.status })
  const rejectDisabled = !canSubmitReject({ canApprove, busy, status: current?.status })

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-gray-200 p-4" aria-label="AI copilot">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900">AI insight</h2>
        <div className="flex items-center gap-2">
          <label htmlFor="insight-panel-locale" className="text-sm text-gray-600">
            Reply locale
          </label>
          <select
            id="insight-panel-locale"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            <option value="auto">Auto</option>
            <option value="th">Thai</option>
            <option value="en">English</option>
          </select>
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
            onClick={handleAskAi}
            disabled={busy}
          >
            {phase === 'requesting' ? 'Asking AI…' : 'Ask AI'}
          </button>
        </div>
      </div>

      <div aria-live="polite" className="text-sm">
        {phase === 'loading' && <p className="text-gray-500">Loading suggestions…</p>}
        {error && <p className="text-red-600">{error}</p>}
      </div>

      {current && (
        <div className="flex flex-col gap-3 rounded border border-gray-200 p-3">
          {current.status === 'PENDING' && <p className="text-xs font-medium text-amber-700">{PENDING_LABEL}</p>}

          {badges.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {badges.map((badge) => (
                <li key={badge} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                  {badge}
                </li>
              ))}
            </ul>
          )}

          {current.flags.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {current.flags.map((flag) => (
                <li key={flag} className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
                  {flag}
                </li>
              ))}
            </ul>
          )}

          <div>
            <p className="text-sm font-medium text-gray-900">Score: {current.score}</p>
            <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">
              {current.scoreReasons.map((reasonText, index) => (
                <li key={`${index}-${reasonText}`}>{reasonText}</li>
              ))}
            </ul>
          </div>

          <p className="text-sm text-gray-700">{current.summary}</p>

          {current.nextBestAction && (
            <div className="rounded bg-gray-50 p-2 text-sm">
              <p className="font-medium text-gray-900">{NBA_LABELS[current.nextBestAction.type]}</p>
              <p className="text-gray-700">{current.nextBestAction.title}</p>
              <p className="text-gray-600">{current.nextBestAction.rationale}</p>
              <p className="text-gray-500">{formatDue(current.nextBestAction.dueInDays)}</p>
            </div>
          )}

          <div>
            <label htmlFor="insight-panel-draft" className="block text-sm font-medium text-gray-900">
              Draft reply
            </label>
            <textarea
              id="insight-panel-draft"
              className="mt-1 w-full rounded border border-gray-300 p-2 text-sm"
              rows={4}
              maxLength={1000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!canApprove || notPending}
            />
            {edited && <p className="mt-1 text-xs text-gray-500">Edited from the AI draft</p>}
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={send}
                disabled={!canApprove || !hasLine || notPending}
                onChange={(e) => setSend(e.target.checked)}
              />
              Send via LINE
              {!hasLine && <span className="text-xs text-gray-500">(Contact has no LINE)</span>}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={applyScore}
                disabled={!canApprove || notPending}
                onChange={(e) => setApplyScore(e.target.checked)}
              />
              Apply score to lead
            </label>
          </div>

          {!canApprove && <p className="text-xs text-gray-500">Only the lead owner or an admin can approve</p>}

          <button
            type="button"
            className="self-start rounded bg-green-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
            onClick={handleApprove}
            disabled={approveDisabled}
          >
            Approve
          </button>

          <div>
            <label htmlFor="insight-panel-reason" className="block text-sm font-medium text-gray-900">
              Rejection reason (optional)
            </label>
            <input
              id="insight-panel-reason"
              type="text"
              className="mt-1 w-full rounded border border-gray-300 p-2 text-sm"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={!canApprove || notPending}
            />
            <button
              type="button"
              className="mt-2 rounded bg-red-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
              onClick={handleReject}
              disabled={rejectDisabled}
            >
              Reject
            </button>
          </div>

          {lastMessage && (
            <p aria-live="polite" className="text-xs text-gray-600">
              Message {lastMessage.status}
              {(lastMessage.status === 'FAILED' || lastMessage.status === 'QUEUED') &&
                ': retry from the message timeline'}
            </p>
          )}
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-gray-900">History</h3>
        <ul className="mt-1 flex flex-col gap-1 text-xs text-gray-600">
          {history.map((item) => (
            <li key={item.id} className="flex justify-between gap-2 border-b border-gray-100 py-1">
              <span>{new Date(item.createdAt).toLocaleString()}</span>
              <span>{item.status}</span>
              <span>{item.source}</span>
              <span>{item.score}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
