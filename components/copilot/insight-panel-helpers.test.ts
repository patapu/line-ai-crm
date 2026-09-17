import { describe, expect, it } from 'vitest'
import type { SuggestionView } from '@/modules/copilot/service'
import {
  BADGE_FALLBACK,
  BADGE_GUARDRAIL,
  BADGE_LOW_CONFIDENCE,
  DRAFT_MAX,
  ERROR_CONFLICT,
  ERROR_FORBIDDEN,
  ERROR_GENERIC,
  InsightRequestError,
  MESSAGE_STATUS_TEXT,
  NBA_LABELS,
  PENDING_LABEL,
  SUGGESTION_SOURCE_LABEL,
  SUGGESTION_STATUS_LABEL,
  SUGGESTION_STATUS_TONE,
  buildApprovePayload,
  buildLoginRedirect,
  canSubmitApprove,
  canSubmitReject,
  describeApiError,
  formatDraftCount,
  formatDue,
  formatHistoryScore,
  getSuggestionBadgeItems,
  getSuggestionBadges,
  isDraftEdited,
  loginRedirectFor,
  pendingToApplyOnActionFailure,
  pickAfterFailureRefresh,
  pickCurrentSuggestion,
  planAskFailure,
  planMountLoad,
  planMountLoadFailure,
  requireBody,
  type MountLoadFailureSnapshot,
  type MountLoadSnapshot,
} from '@/components/copilot/insight-panel-helpers'

// [B] components/copilot/insight-panel-helpers.test.ts (G8). Pure functions,
// no React, no DOM tooling. `SuggestionView` is imported as a type only, so
// this file never actually loads modules/copilot/service.ts at runtime. See
// S4-plan.md section G8.

function makeSuggestion(overrides: Partial<SuggestionView> = {}): SuggestionView {
  return {
    id: 'csugg0000000000000000001',
    leadId: 'clead00000000000000000001',
    status: 'PENDING',
    source: 'MODEL',
    lowConfidence: false,
    confidence: 0.8,
    summary: 'Summary text',
    score: 70,
    scoreReasons: ['Stage QUALIFIED: base score 45'],
    nextBestAction: { type: 'CALL', title: 'Call', rationale: 'Because', suggestedStage: null, dueInDays: 1 },
    draftReply: 'Hello there',
    flags: [],
    model: 'gemini-flash-latest',
    promptVersion: 'crm-copilot-v1',
    latencyMs: 120,
    errorCode: null,
    requestedById: 'cuser00000000000000000001',
    decidedById: null,
    decidedAt: null,
    createdAt: '2026-09-15T00:00:00.000Z',
    ...overrides,
  }
}

describe('constants', () => {
  it('PENDING_LABEL is the fixed panel copy', () => {
    expect(PENDING_LABEL).toBe('คำแนะนำจาก AI ยังไม่ถูกบันทึกลง lead จนกว่าคุณจะอนุมัติ')
  })

  it('NBA_LABELS covers every next-best-action type', () => {
    const types = [
      'REPLY_LINE',
      'CALL',
      'SEND_PROPOSAL',
      'SCHEDULE_MEETING',
      'FOLLOW_UP_LATER',
      'MOVE_STAGE',
      'HANDOFF_TO_HUMAN',
      'CLOSE_LOST',
    ] as const
    for (const type of types) {
      expect(typeof NBA_LABELS[type]).toBe('string')
      expect(NBA_LABELS[type].length).toBeGreaterThan(0)
    }
  })
})

describe('getSuggestionBadges', () => {
  it('returns no badges for a confident MODEL suggestion with no error', () => {
    expect(getSuggestionBadges(makeSuggestion())).toEqual([])
  })

  it('badges a FALLBACK source', () => {
    expect(getSuggestionBadges(makeSuggestion({ source: 'FALLBACK' }))).toContain(BADGE_FALLBACK)
  })

  it('badges lowConfidence', () => {
    expect(getSuggestionBadges(makeSuggestion({ lowConfidence: true }))).toContain(BADGE_LOW_CONFIDENCE)
  })

  it('badges a GUARDRAIL_BLOCKED errorCode', () => {
    expect(getSuggestionBadges(makeSuggestion({ errorCode: 'GUARDRAIL_BLOCKED' }))).toContain(BADGE_GUARDRAIL)
  })

  it('can combine all three badges', () => {
    const badges = getSuggestionBadges(
      makeSuggestion({ source: 'FALLBACK', lowConfidence: true, errorCode: 'GUARDRAIL_BLOCKED' }),
    )
    expect(badges).toEqual([BADGE_FALLBACK, BADGE_LOW_CONFIDENCE, BADGE_GUARDRAIL])
  })
})

describe('pickCurrentSuggestion', () => {
  it('returns null for an empty list', () => {
    expect(pickCurrentSuggestion([])).toBeNull()
  })

  it('returns null when nothing is PENDING', () => {
    const items = [makeSuggestion({ id: 'a', status: 'APPROVED' }), makeSuggestion({ id: 'b', status: 'REJECTED' })]
    expect(pickCurrentSuggestion(items)).toBeNull()
  })

  it('returns the newest PENDING item regardless of array order', () => {
    const older = makeSuggestion({ id: 'older', status: 'PENDING', createdAt: '2026-09-10T00:00:00.000Z' })
    const newer = makeSuggestion({ id: 'newer', status: 'PENDING', createdAt: '2026-09-14T00:00:00.000Z' })
    const approved = makeSuggestion({ id: 'approved', status: 'APPROVED', createdAt: '2026-09-15T00:00:00.000Z' })
    expect(pickCurrentSuggestion([older, approved, newer])?.id).toBe('newer')
  })
})

describe('isDraftEdited', () => {
  it('is false when the draft equals the original after trimming both sides', () => {
    expect(isDraftEdited('Hello there', '  Hello there  ')).toBe(false)
  })

  it('is true when the draft differs from the original', () => {
    expect(isDraftEdited('Hello there', 'Something else')).toBe(true)
  })

  it('treats a null original as an empty string', () => {
    expect(isDraftEdited(null, '')).toBe(false)
    expect(isDraftEdited(null, 'New text')).toBe(true)
  })
})

describe('buildApprovePayload', () => {
  it('includes replyText when the draft is non-empty, trimmed', () => {
    expect(buildApprovePayload({ send: true, applyScore: false, draft: '  hi there  ' })).toEqual({
      send: true,
      applyScore: false,
      replyText: 'hi there',
    })
  })

  it('omits replyText when the draft is empty or whitespace-only', () => {
    expect(buildApprovePayload({ send: false, applyScore: true, draft: '   ' })).toEqual({
      send: false,
      applyScore: true,
    })
  })
})

describe('canSubmitApprove', () => {
  it('is false when canApprove is false', () => {
    expect(canSubmitApprove({ canApprove: false, busy: false, send: false, hasLine: true, draft: 'x' })).toBe(false)
  })

  it('is false while busy', () => {
    expect(canSubmitApprove({ canApprove: true, busy: true, send: false, hasLine: true, draft: 'x' })).toBe(false)
  })

  it('is false when send is requested but the contact has no LINE', () => {
    expect(canSubmitApprove({ canApprove: true, busy: false, send: true, hasLine: false, draft: 'x' })).toBe(false)
  })

  it('is false when send is requested but the draft is empty', () => {
    expect(canSubmitApprove({ canApprove: true, busy: false, send: true, hasLine: true, draft: '   ' })).toBe(false)
  })

  it('is true when send is requested with LINE available and a non-empty draft', () => {
    expect(canSubmitApprove({ canApprove: true, busy: false, send: true, hasLine: true, draft: 'hi' })).toBe(true)
  })

  it('is true for a non-send approve regardless of hasLine/draft', () => {
    expect(canSubmitApprove({ canApprove: true, busy: false, send: false, hasLine: false, draft: '' })).toBe(true)
  })

  it('is true when status is PENDING (S11 fix pass 1)', () => {
    expect(
      canSubmitApprove({ canApprove: true, busy: false, send: false, hasLine: true, draft: 'x', status: 'PENDING' }),
    ).toBe(true)
  })

  it('is true when status is omitted (S11 fix pass 1)', () => {
    expect(canSubmitApprove({ canApprove: true, busy: false, send: false, hasLine: true, draft: 'x' })).toBe(true)
  })

  it.each(['APPROVED', 'REJECTED', 'SUPERSEDED'] as const)(
    'is false when status is %s, even though every other field allows it (S11 fix pass 1)',
    (status) => {
      expect(
        canSubmitApprove({ canApprove: true, busy: false, send: false, hasLine: true, draft: 'x', status }),
      ).toBe(false)
    },
  )
})

describe('canSubmitReject (S11 fix pass 1)', () => {
  it('is false when canApprove is false', () => {
    expect(canSubmitReject({ canApprove: false, busy: false })).toBe(false)
  })

  it('is false while busy', () => {
    expect(canSubmitReject({ canApprove: true, busy: true })).toBe(false)
  })

  it('is true when canApprove and not busy, with status omitted or PENDING', () => {
    expect(canSubmitReject({ canApprove: true, busy: false })).toBe(true)
    expect(canSubmitReject({ canApprove: true, busy: false, status: 'PENDING' })).toBe(true)
  })

  it.each(['APPROVED', 'REJECTED', 'SUPERSEDED'] as const)(
    'is false when status is %s',
    (status) => {
      expect(canSubmitReject({ canApprove: true, busy: false, status })).toBe(false)
    },
  )
})

describe('describeApiError', () => {
  it('gives a specific hint on 409', () => {
    expect(describeApiError(409, { error: { message: 'ignored' } })).toBe(ERROR_CONFLICT)
  })

  it('gives a specific hint on 403, ignoring any server message', () => {
    expect(describeApiError(403, { error: { message: 'ignored' } })).toBe(ERROR_FORBIDDEN)
    expect(describeApiError(403, null)).toBe(ERROR_FORBIDDEN)
  })

  it('uses the server message for other statuses', () => {
    expect(describeApiError(422, { error: { message: 'no reply text' } })).toBe('no reply text')
  })

  it('falls back to a generic message when the body has no error message', () => {
    expect(describeApiError(500, null)).toBe(ERROR_GENERIC)
    expect(describeApiError(400, {})).toBe(ERROR_GENERIC)
  })
})

describe('buildLoginRedirect', () => {
  it('encodes pathname and search the same way as components/crm/auth-redirect.ts', () => {
    expect(buildLoginRedirect('/leads/clead0001', '')).toBe('/login?next=%2Fleads%2Fclead0001')
  })

  it('includes and encodes the search string when present', () => {
    expect(buildLoginRedirect('/leads/clead0001', '?tab=notes&x=1')).toBe(
      `/login?next=${encodeURIComponent('/leads/clead0001?tab=notes&x=1')}`,
    )
  })

  it('returns null when already on /login, so a 401 there never loops', () => {
    expect(buildLoginRedirect('/login', '')).toBeNull()
    expect(buildLoginRedirect('/login', '?next=%2Fleads')).toBeNull()
  })
})

describe('loginRedirectFor (S3 round 2)', () => {
  it('returns the login path for an InsightRequestError with status 401', () => {
    const err = new InsightRequestError(401, 'unauthorized')
    expect(loginRedirectFor(err, '/leads/clead0001', '')).toBe('/login?next=%2Fleads%2Fclead0001')
  })

  it.each([403, 409, 500])('returns null for an InsightRequestError with status %d', (status) => {
    const err = new InsightRequestError(status, 'nope')
    expect(loginRedirectFor(err, '/leads/clead0001', '')).toBeNull()
  })

  it('returns null for a plain Error', () => {
    expect(loginRedirectFor(new Error('boom'), '/leads/clead0001', '')).toBeNull()
  })

  it('returns null for a non-error value', () => {
    expect(loginRedirectFor('not an error', '/leads/clead0001', '')).toBeNull()
    expect(loginRedirectFor(null, '/leads/clead0001', '')).toBeNull()
    expect(loginRedirectFor(undefined, '/leads/clead0001', '')).toBeNull()
  })

  it('returns null when pathname is /login, even for a 401', () => {
    const err = new InsightRequestError(401, 'unauthorized')
    expect(loginRedirectFor(err, '/login', '')).toBeNull()
  })
})

describe('planMountLoad', () => {
  // All 8 boolean combinations of { historyRefreshed, actionCommitted, actionInFlight }.
  // applyHistory = !historyRefreshed regardless of the other two flags;
  // historyRefreshed now forces current: 'skip' unconditionally (checked
  // before actionCommitted/actionInFlight); otherwise current precedence is
  // committed > inFlight > apply.
  it.each([
    [{ historyRefreshed: false, actionCommitted: false, actionInFlight: false }, { applyHistory: true, current: 'apply' }],
    [{ historyRefreshed: false, actionCommitted: false, actionInFlight: true }, { applyHistory: true, current: 'stash' }],
    [{ historyRefreshed: false, actionCommitted: true, actionInFlight: false }, { applyHistory: true, current: 'skip' }],
    [{ historyRefreshed: false, actionCommitted: true, actionInFlight: true }, { applyHistory: true, current: 'skip' }],
    [{ historyRefreshed: true, actionCommitted: false, actionInFlight: false }, { applyHistory: false, current: 'skip' }],
    [{ historyRefreshed: true, actionCommitted: false, actionInFlight: true }, { applyHistory: false, current: 'skip' }],
    [{ historyRefreshed: true, actionCommitted: true, actionInFlight: false }, { applyHistory: false, current: 'skip' }],
    [{ historyRefreshed: true, actionCommitted: true, actionInFlight: true }, { applyHistory: false, current: 'skip' }],
  ] as const)('%j -> %j', (snapshot: MountLoadSnapshot, expected) => {
    expect(planMountLoad(snapshot)).toEqual(expected)
  })

  it('committed takes precedence over inFlight (both true still skips, never stashes)', () => {
    const plan = planMountLoad({ historyRefreshed: false, actionCommitted: true, actionInFlight: true })
    expect(plan.current).toBe('skip')
  })

  it('historyRefreshed forces skip even when nothing else has touched current (finding 2, pass 2)', () => {
    const plan = planMountLoad({ historyRefreshed: true, actionCommitted: false, actionInFlight: false })
    expect(plan).toEqual({ applyHistory: false, current: 'skip' })
  })
})

describe('pendingToApplyOnActionFailure', () => {
  it('returns null when current is already set, regardless of stashed', () => {
    const current = makeSuggestion({ id: 'current' })
    const stashed = makeSuggestion({ id: 'stashed' })
    expect(pendingToApplyOnActionFailure({ current, stashed })).toBeNull()
  })

  it('returns null when current is set and stashed is null', () => {
    const current = makeSuggestion({ id: 'current' })
    expect(pendingToApplyOnActionFailure({ current, stashed: null })).toBeNull()
  })

  it('returns the stashed suggestion verbatim when current is null', () => {
    const stashed = makeSuggestion({ id: 'stashed' })
    expect(pendingToApplyOnActionFailure({ current: null, stashed })).toBe(stashed)
  })

  it('returns null when both current and stashed are null', () => {
    expect(pendingToApplyOnActionFailure({ current: null, stashed: null })).toBeNull()
  })
})

describe('planMountLoad + pendingToApplyOnActionFailure composed scenarios', () => {
  it('a failed Ask AI during an in-flight mount load ends with the stashed PENDING suggestion applied', () => {
    const stashedFromMount = makeSuggestion({ id: 'mount-pending', status: 'PENDING' })

    // Mount load resolves while Ask AI is in flight: stash, don't apply.
    const plan = planMountLoad({ historyRefreshed: false, actionCommitted: false, actionInFlight: true })
    expect(plan.current).toBe('stash')
    // Simulates the component: stashedPendingRef.current = pending
    const stashedPendingRef = { current: stashedFromMount }

    // Ask AI then fails without ever setting `current` (still null).
    const applied = pendingToApplyOnActionFailure({ current: null, stashed: stashedPendingRef.current })
    expect(applied).toBe(stashedFromMount)
  })

  it('a slow mount load after a successful refresh does not apply history or current (finding 2, pass 2)', () => {
    // refreshHistory() already succeeded (historyRefreshedRef set), no action ever ran.
    const plan = planMountLoad({ historyRefreshed: true, actionCommitted: false, actionInFlight: false })
    expect(plan.applyHistory).toBe(false)
    // current is skipped too: the refresh is newer truth than this slower
    // mount load, so applying now could roll current/draft back to stale data.
    expect(plan.current).toBe('skip')
  })
})

describe('planMountLoadFailure', () => {
  // Truth table over all 2x2 combinations of actionInFlight/actionCommitted:
  // showLoadError is true only when both are false. `redirecting` was
  // removed from MountLoadFailureSnapshot entirely (finding 5, pass 2): a
  // 401 never reaches this function, so there is no longer a field for it.
  it.each([
    [{ actionInFlight: false, actionCommitted: false }, true],
    [{ actionInFlight: false, actionCommitted: true }, false],
    [{ actionInFlight: true, actionCommitted: false }, false],
    [{ actionInFlight: true, actionCommitted: true }, false],
  ] as const)('%j -> showLoadError %s', (snapshot: MountLoadFailureSnapshot, expected) => {
    expect(planMountLoadFailure(snapshot)).toEqual({ showLoadError: expected })
  })
})

describe('pickAfterFailureRefresh', () => {
  it('same id still PENDING in items: returns input.current back by reference (no-op, keeps the draft from resetting over identical data)', () => {
    const current = makeSuggestion({ id: 'rendered', status: 'PENDING', createdAt: '2026-09-15T00:00:00.000Z' })
    const sameFromServer = makeSuggestion({ id: 'rendered', status: 'PENDING', createdAt: '2026-09-15T00:00:00.000Z' })
    const result = pickAfterFailureRefresh({ current, items: [sameFromServer] })
    expect(result).toBe(current)
  })

  it('rendered superseded, a newer PENDING item exists: returns the newer item', () => {
    const current = makeSuggestion({ id: 'rendered', status: 'PENDING', createdAt: '2026-09-15T00:00:00.000Z' })
    const superseded = makeSuggestion({ id: 'rendered', status: 'SUPERSEDED', createdAt: '2026-09-15T00:00:00.000Z' })
    const newer = makeSuggestion({ id: 'newer', status: 'PENDING', createdAt: '2026-09-16T00:00:00.000Z' })
    const result = pickAfterFailureRefresh({ current, items: [superseded, newer] })
    expect(result).toBe(newer)
  })

  it('no PENDING item at all: returns null', () => {
    const current = makeSuggestion({ id: 'rendered', status: 'PENDING' })
    const superseded = makeSuggestion({ id: 'rendered', status: 'SUPERSEDED' })
    const rejected = makeSuggestion({ id: 'other', status: 'REJECTED' })
    expect(pickAfterFailureRefresh({ current, items: [superseded, rejected] })).toBeNull()
    expect(pickAfterFailureRefresh({ current, items: [] })).toBeNull()
  })

  it('current is null, items has a PENDING item: returns that item (no id to match against)', () => {
    const pending = makeSuggestion({ id: 'fresh', status: 'PENDING' })
    expect(pickAfterFailureRefresh({ current: null, items: [pending] })).toBe(pending)
  })

  it('current is null, no PENDING item: returns null', () => {
    expect(pickAfterFailureRefresh({ current: null, items: [] })).toBeNull()
    expect(pickAfterFailureRefresh({ current: null, items: [makeSuggestion({ status: 'APPROVED' })] })).toBeNull()
  })

  it('multiple PENDING items in the list: picks the newest by createdAt, per pickCurrentSuggestion semantics', () => {
    const current = makeSuggestion({ id: 'rendered', status: 'PENDING', createdAt: '2026-09-10T00:00:00.000Z' })
    const superseded = makeSuggestion({ id: 'rendered', status: 'SUPERSEDED', createdAt: '2026-09-10T00:00:00.000Z' })
    const older = makeSuggestion({ id: 'older', status: 'PENDING', createdAt: '2026-09-14T00:00:00.000Z' })
    const newest = makeSuggestion({ id: 'newest', status: 'PENDING', createdAt: '2026-09-16T00:00:00.000Z' })
    const result = pickAfterFailureRefresh({ current, items: [older, superseded, newest] })
    expect(result).toBe(newest)
  })
})

describe('planAskFailure (S1 fix pass 3, replaces the old ad hoc refresh-then-re-pick logic in handleAskAi)', () => {
  // `rendered` MUST be what the component's own render actually had on
  // screen at click time, never the mount load's stash: the stash is never
  // the comparison baseline (see planAskFailure's own doc comment for why).
  const renderedPending = makeSuggestion({ id: 'rendered-pending', status: 'PENDING', createdAt: '2026-09-15T00:00:00.000Z' })
  const renderedApproved = makeSuggestion({ id: 'rendered-approved', status: 'APPROVED', createdAt: '2026-09-15T00:00:00.000Z' })
  const stash = makeSuggestion({ id: 'stash-pending', status: 'PENDING', createdAt: '2026-09-14T00:00:00.000Z' })
  const supersededRendered = makeSuggestion({ id: 'rendered-pending', status: 'SUPERSEDED', createdAt: '2026-09-15T00:00:00.000Z' })
  const newerPending = makeSuggestion({ id: 'newer-pending', status: 'PENDING', createdAt: '2026-09-16T00:00:00.000Z' })

  const cases: Array<[string, Parameters<typeof planAskFailure>[0], ReturnType<typeof planAskFailure>]> = [
    [
      'refresh failed, nothing rendered, nothing stashed: no-op',
      { rendered: null, stashed: null, refreshed: null },
      { next: null, replace: false, resetDecisionInputs: false },
    ],
    [
      'refresh failed, nothing rendered, a stash exists: applies the stash (mirrors pendingToApplyOnActionFailure)',
      { rendered: null, stashed: stash, refreshed: null },
      { next: stash, replace: true, resetDecisionInputs: true },
    ],
    [
      'refresh failed, something was rendered: keeps it regardless of any stash (stash is never the baseline)',
      { rendered: renderedPending, stashed: stash, refreshed: null },
      { next: renderedPending, replace: false, resetDecisionInputs: false },
    ],
    [
      'refresh failed, a decided suggestion was rendered: keeps it too, outcome/lastMessage untouched',
      { rendered: renderedApproved, stashed: stash, refreshed: null },
      { next: renderedApproved, replace: false, resetDecisionInputs: false },
    ],
    [
      // Anti-regression case: rendered X-decided, stash null, refreshed [] -> replace false.
      // Using the stash as the baseline instead of `rendered` has no bearing
      // here since stashed is null, but this still fails if the function
      // clears `rendered` just because `refreshed` found no PENDING item.
      'refreshed, rendered decided (APPROVED), no PENDING at all: keeps rendered, its outcome/lastMessage untouched (finding 1, S1 fix pass 3)',
      { rendered: renderedApproved, stashed: null, refreshed: [] },
      { next: renderedApproved, replace: false, resetDecisionInputs: false },
    ],
    [
      'refreshed, rendered decided (APPROVED), a stash also exists but is never consulted: still keeps rendered',
      { rendered: renderedApproved, stashed: stash, refreshed: [] },
      { next: renderedApproved, replace: false, resetDecisionInputs: false },
    ],
    [
      // Distinct from the two cases above: here `refreshed` DOES contain a
      // genuine PENDING item (a fresh Ask AI re-pick landing after this
      // rendered suggestion was already decided in this session), so the
      // "rendered decided + no PENDING at all" short-circuit does not apply
      // and this must fall through to the pickAfterFailureRefresh compare,
      // which finds a different id and replaces.
      'refreshed, rendered decided (APPROVED), refresh finds a genuine (different-id) PENDING item: replaces rendered and resets decision inputs',
      { rendered: renderedApproved, stashed: null, refreshed: [newerPending] },
      { next: newerPending, replace: true, resetDecisionInputs: true },
    ],
    [
      'refreshed, rendered PENDING, same id still PENDING: no-op (draft untouched)',
      { rendered: renderedPending, stashed: null, refreshed: [renderedPending] },
      { next: renderedPending, replace: false, resetDecisionInputs: false },
    ],
    [
      'refreshed, rendered PENDING, superseded by a newer PENDING item: swaps to the newer one and resets decision inputs',
      { rendered: renderedPending, stashed: null, refreshed: [supersededRendered, newerPending] },
      { next: newerPending, replace: true, resetDecisionInputs: true },
    ],
    [
      'refreshed, rendered PENDING, no PENDING item left: clears current and resets decision inputs too, since replace is true',
      { rendered: renderedPending, stashed: null, refreshed: [supersededRendered] },
      { next: null, replace: true, resetDecisionInputs: true },
    ],
    [
      'refreshed, nothing rendered, no PENDING item exists either: no-op (both null)',
      { rendered: null, stashed: stash, refreshed: [] },
      { next: null, replace: false, resetDecisionInputs: false },
    ],
    [
      // Anti-regression case: rendered null, stash X, refreshed [X PENDING] -> replace true, next X.
      // This is the major regression the S1 fix pass 2/3 lineage fixed: if
      // the comparison baseline were the stash instead of `rendered` (null),
      // X would look like a same-id no-op and never get applied, silently
      // hiding a PENDING suggestion from the screen.
      'nothing rendered, a stash exists, and the refresh confirms the stash is still the newest PENDING row: applies it, comparing against rendered (null), never against the stash itself',
      { rendered: null, stashed: stash, refreshed: [stash] },
      { next: stash, replace: true, resetDecisionInputs: true },
    ],
  ]

  it.each(cases)('%s', (_name, input, expected) => {
    expect(planAskFailure(input)).toEqual(expected)
  })
})

describe('InsightRequestError', () => {
  it('carries status and message, and is an instanceof Error', () => {
    const err = new InsightRequestError(409, ERROR_CONFLICT)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(InsightRequestError)
    expect(err.status).toBe(409)
    expect(err.message).toBe(ERROR_CONFLICT)
    expect(err.name).toBe('InsightRequestError')
  })
})

describe('formatDraftCount', () => {
  it('formats a count against DRAFT_MAX', () => {
    expect(formatDraftCount(0)).toBe(`0/${DRAFT_MAX} ตัวอักษร`)
    expect(formatDraftCount(42)).toBe(`42/${DRAFT_MAX} ตัวอักษร`)
    expect(formatDraftCount(DRAFT_MAX)).toBe(`${DRAFT_MAX}/${DRAFT_MAX} ตัวอักษร`)
  })
})

describe('formatHistoryScore', () => {
  it('formats a score', () => {
    expect(formatHistoryScore(0)).toBe('คะแนน 0')
    expect(formatHistoryScore(70)).toBe('คะแนน 70')
  })
})

describe('getSuggestionBadgeItems', () => {
  it('returns an empty array for a confident MODEL suggestion with no error', () => {
    expect(getSuggestionBadgeItems(makeSuggestion())).toEqual([])
  })

  it('always orders items FALLBACK, then LOW_CONFIDENCE, then GUARDRAIL_BLOCKED, regardless of which combination is present', () => {
    const all = getSuggestionBadgeItems(
      makeSuggestion({ source: 'FALLBACK', lowConfidence: true, errorCode: 'GUARDRAIL_BLOCKED' }),
    )
    expect(all.map((item) => item.id)).toEqual(['FALLBACK', 'LOW_CONFIDENCE', 'GUARDRAIL_BLOCKED'])
  })

  it('tones each badge item: FALLBACK gray, LOW_CONFIDENCE amber, GUARDRAIL_BLOCKED violet', () => {
    const all = getSuggestionBadgeItems(
      makeSuggestion({ source: 'FALLBACK', lowConfidence: true, errorCode: 'GUARDRAIL_BLOCKED' }),
    )
    expect(all.find((item) => item.id === 'FALLBACK')?.tone).toBe('gray')
    expect(all.find((item) => item.id === 'LOW_CONFIDENCE')?.tone).toBe('amber')
    expect(all.find((item) => item.id === 'GUARDRAIL_BLOCKED')?.tone).toBe('violet')
  })

  it('getSuggestionBadges labels stay in the same order as getSuggestionBadgeItems', () => {
    const s = makeSuggestion({ source: 'FALLBACK', lowConfidence: true, errorCode: 'GUARDRAIL_BLOCKED' })
    expect(getSuggestionBadges(s)).toEqual(getSuggestionBadgeItems(s).map((item) => item.label))
  })
})

describe('label maps cover every enum key', () => {
  it('SUGGESTION_STATUS_LABEL and SUGGESTION_STATUS_TONE cover every SuggestionStatus', () => {
    const statuses = ['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED'] as const
    for (const status of statuses) {
      expect(typeof SUGGESTION_STATUS_LABEL[status]).toBe('string')
      expect(SUGGESTION_STATUS_LABEL[status].length).toBeGreaterThan(0)
      expect(typeof SUGGESTION_STATUS_TONE[status]).toBe('string')
    }
  })

  it('SUGGESTION_SOURCE_LABEL covers every SuggestionSource', () => {
    const sources = ['MODEL', 'FALLBACK'] as const
    for (const source of sources) {
      expect(typeof SUGGESTION_SOURCE_LABEL[source]).toBe('string')
      expect(SUGGESTION_SOURCE_LABEL[source].length).toBeGreaterThan(0)
    }
  })

  it('MESSAGE_STATUS_TEXT covers every MessageStatus, including LOGGED', () => {
    const statuses = ['SENT', 'QUEUED', 'FAILED', 'RECEIVED', 'LOGGED'] as const
    for (const status of statuses) {
      expect(typeof MESSAGE_STATUS_TEXT[status]).toBe('string')
      expect(MESSAGE_STATUS_TEXT[status].length).toBeGreaterThan(0)
    }
  })

  it('MESSAGE_STATUS_TEXT.QUEUED names the Retry button and the 1 minute wait, since MessageBubble shows Retry immediately but retry returns 409 within 60s of updatedAt', () => {
    expect(MESSAGE_STATUS_TEXT.QUEUED).toContain('Retry')
    expect(MESSAGE_STATUS_TEXT.QUEUED).toContain('1 นาที')
  })

  it('NBA_LABELS covers every NextBestAction type', () => {
    const types = [
      'REPLY_LINE',
      'CALL',
      'SEND_PROPOSAL',
      'SCHEDULE_MEETING',
      'FOLLOW_UP_LATER',
      'MOVE_STAGE',
      'HANDOFF_TO_HUMAN',
      'CLOSE_LOST',
    ] as const
    for (const type of types) {
      expect(typeof NBA_LABELS[type]).toBe('string')
      expect(NBA_LABELS[type].length).toBeGreaterThan(0)
    }
  })
})

describe('formatDue', () => {
  it('formats null as no due date', () => {
    expect(formatDue(null)).toBe('ไม่มีกำหนดเวลา')
  })

  it('formats 0 as due today', () => {
    expect(formatDue(0)).toBe('ควรทำภายในวันนี้')
  })

  it('formats 1 as singular', () => {
    expect(formatDue(1)).toBe('ควรทำภายใน 1 วัน')
  })

  it('formats other values as plural', () => {
    expect(formatDue(5)).toBe('ควรทำภายใน 5 วัน')
  })
})

describe('requireBody (moved from InsightPanel.tsx for testability, S12)', () => {
  it('does not throw for a plain object', () => {
    expect(() => requireBody({ items: [] })).not.toThrow()
  })

  it('does not throw for an empty object', () => {
    expect(() => requireBody({})).not.toThrow()
  })

  it('throws the generic message for null', () => {
    expect(() => requireBody(null)).toThrow(ERROR_GENERIC)
  })

  it('throws the generic message for undefined', () => {
    expect(() => requireBody(undefined)).toThrow(ERROR_GENERIC)
  })

  it('throws for a string body (e.g. a non-JSON response coerced to text)', () => {
    expect(() => requireBody('not json')).toThrow(ERROR_GENERIC)
  })

  it('throws for a number body', () => {
    expect(() => requireBody(42)).toThrow(ERROR_GENERIC)
  })

  // typeof [] === 'object', so an array body passes this guard: documenting
  // the actual behavior (requireBody only rules out null/non-object) rather
  // than asserting a stricter shape check it does not perform.
  it('does not throw for an array body', () => {
    expect(() => requireBody([])).not.toThrow()
  })
})

describe('requireBody with required keys (S17/S18 T7, requireBody(body, ...requiredKeys))', () => {
  it('does not throw when no required keys are given, same as before (unchanged behavior)', () => {
    expect(() => requireBody({})).not.toThrow()
    expect(() => requireBody({ items: [] })).not.toThrow()
    expect(() => requireBody([])).not.toThrow()
  })

  it('does not throw when every required key is present and neither undefined nor null', () => {
    expect(() => requireBody({ suggestion: { id: 'x' } }, 'suggestion')).not.toThrow()
    expect(() => requireBody({ items: [], other: 1 }, 'items')).not.toThrow()
  })

  it('throws the generic message when a required key is missing entirely', () => {
    expect(() => requireBody({}, 'items')).toThrow(ERROR_GENERIC)
  })

  it('throws the generic message when a required key is explicitly undefined', () => {
    expect(() => requireBody({ suggestion: undefined }, 'suggestion')).toThrow(ERROR_GENERIC)
  })

  it('throws the generic message when a required key is explicitly null', () => {
    expect(() => requireBody({ suggestion: null }, 'suggestion')).toThrow(ERROR_GENERIC)
  })

  it('throws when any one of several required keys is missing', () => {
    expect(() => requireBody({ items: [] }, 'items', 'suggestion')).toThrow(ERROR_GENERIC)
  })

  it('does not throw when all of several required keys are present', () => {
    expect(() => requireBody({ items: [], suggestion: {} }, 'items', 'suggestion')).not.toThrow()
  })

  it('still throws for a null/non-object body even when required keys are given', () => {
    expect(() => requireBody(null, 'items')).toThrow(ERROR_GENERIC)
    expect(() => requireBody('not json', 'items')).toThrow(ERROR_GENERIC)
  })

  it('a falsy-but-present value (0, "", false) for a required key does not throw (only undefined/null do)', () => {
    expect(() => requireBody({ suggestion: 0 }, 'suggestion')).not.toThrow()
    expect(() => requireBody({ suggestion: '' }, 'suggestion')).not.toThrow()
    expect(() => requireBody({ suggestion: false }, 'suggestion')).not.toThrow()
  })
})
