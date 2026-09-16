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
  pickCurrentSuggestion,
  requireBody,
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
