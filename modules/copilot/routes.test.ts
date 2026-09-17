import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DomainError } from '@/lib/errors'
import type { Actor } from '@/lib/auth/dal'

// [B] modules/copilot/routes.test.ts (G7). No DB: requireUser and the
// service functions are mocked; the real view mappers (toSuggestionView,
// toApprovedMessageView) are kept so the response shape is checked for
// real. See S4-plan.md section G7 and section D.

vi.mock('server-only', () => ({}))

vi.mock('@/lib/auth/dal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/dal')>()
  return { ...actual, requireUser: vi.fn() }
})

vi.mock('@/modules/copilot/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/copilot/service')>()
  return {
    ...actual,
    requestInsight: vi.fn(),
    listSuggestions: vi.fn(),
    approveSuggestion: vi.fn(),
    rejectSuggestion: vi.fn(),
  }
})

import { requireUser } from '@/lib/auth/dal'
import {
  approveSuggestion,
  listSuggestions,
  rejectSuggestion,
  requestInsight,
  toApprovedMessageView,
  toSuggestionView,
} from '@/modules/copilot/service'
import { POST as insightsPost } from '@/app/api/leads/[id]/insights/route'
import { GET as suggestionsGet } from '@/app/api/leads/[id]/suggestions/route'
import { POST as approvePost } from '@/app/api/suggestions/[id]/approve/route'
import { POST as rejectPost } from '@/app/api/suggestions/[id]/reject/route'

const VALID_LEAD_ID = 'clead00000000000000000001'
const APP_ORIGIN = 'http://localhost:3000' // matches vitest.setup.ts's APP_URL

const actor: Extract<Actor, { kind: 'user' }> = {
  kind: 'user',
  id: 'cuser00000000000000000001',
  role: 'SALES',
  name: 'Tester',
}

function ctxFor(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

function makeRequest(
  url: string,
  opts: { method?: string; origin?: string; contentType?: string; body?: string } = {},
): NextRequest {
  const { method = 'GET', origin = APP_ORIGIN, contentType, body } = opts
  const headers: Record<string, string> = {}
  if (method !== 'GET' && method !== 'HEAD') headers['origin'] = origin
  if (contentType !== undefined) headers['content-type'] = contentType
  if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body))
  return new NextRequest(url, { method, headers, body })
}

function makeSuggestionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'csugg0000000000000000009',
    leadId: VALID_LEAD_ID,
    status: 'PENDING',
    source: 'MODEL',
    lowConfidence: false,
    confidence: 0.8,
    summary: 'Summary text',
    score: 70,
    scoreReasons: ['Stage QUALIFIED: base score 45'],
    nextBestAction: { type: 'CALL', title: 'Call', rationale: 'Because', suggestedStage: null, dueInDays: 1 },
    draftReply: 'Hello',
    flags: [],
    model: 'gemini-flash-latest',
    promptVersion: 'crm-copilot-v1',
    latencyMs: 120,
    errorCode: null,
    requestedById: 'cuser00000000000000000001',
    decidedById: null,
    decidedAt: null,
    createdAt: new Date('2026-09-15T00:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(requireUser).mockReset()
  vi.mocked(requestInsight).mockReset()
  vi.mocked(listSuggestions).mockReset()
  vi.mocked(approveSuggestion).mockReset()
  vi.mocked(rejectSuggestion).mockReset()
})

describe('POST /api/leads/[id]/insights', () => {
  it('returns 401 when there is no valid session, and never calls requestInsight', async () => {
    vi.mocked(requireUser).mockRejectedValue(new DomainError('UNAUTHENTICATED', 'no valid session'))
    const req = makeRequest(`${APP_ORIGIN}/api/leads/${VALID_LEAD_ID}/insights`, {
      method: 'POST',
      contentType: 'application/json',
      body: '{}',
    })

    const res = await insightsPost(req, ctxFor(VALID_LEAD_ID))

    expect(res.status).toBe(401)
    expect(requestInsight).not.toHaveBeenCalled()
  })

  it('returns 400 for an id that is not a cuid', async () => {
    vi.mocked(requireUser).mockResolvedValue(actor)
    const req = makeRequest(`${APP_ORIGIN}/api/leads/not-an-id/insights`, {
      method: 'POST',
      contentType: 'application/json',
      body: '{}',
    })

    const res = await insightsPost(req, ctxFor('not-an-id'))

    expect(res.status).toBe(400)
  })

  it('returns 201 with the created suggestion, passing leadId/actor/replyLocale through to requestInsight', async () => {
    vi.mocked(requireUser).mockResolvedValue(actor)
    const row = makeSuggestionRow()
    vi.mocked(requestInsight).mockResolvedValue(row as never)
    const req = makeRequest(`${APP_ORIGIN}/api/leads/${VALID_LEAD_ID}/insights`, {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ replyLocale: 'en' }),
    })

    const res = await insightsPost(req, ctxFor(VALID_LEAD_ID))

    expect(res.status).toBe(201)
    expect(requestInsight).toHaveBeenCalledWith({ leadId: VALID_LEAD_ID, actor, replyLocale: 'en' }, {})
    const body = (await res.json()) as { suggestion: unknown }
    expect(body.suggestion).toEqual(toSuggestionView(row as never))
  })

  it('passes a NOT_FOUND domain error through as a 404', async () => {
    vi.mocked(requireUser).mockResolvedValue(actor)
    vi.mocked(requestInsight).mockRejectedValue(new DomainError('NOT_FOUND', 'lead not found'))
    const req = makeRequest(`${APP_ORIGIN}/api/leads/${VALID_LEAD_ID}/insights`, {
      method: 'POST',
      contentType: 'application/json',
      body: '{}',
    })

    const res = await insightsPost(req, ctxFor(VALID_LEAD_ID))

    expect(res.status).toBe(404)
  })

  it('returns 403 on a cross-origin POST, and never calls requireUser', async () => {
    const req = makeRequest(`${APP_ORIGIN}/api/leads/${VALID_LEAD_ID}/insights`, {
      method: 'POST',
      origin: 'https://evil.example',
      contentType: 'application/json',
      body: '{}',
    })

    const res = await insightsPost(req, ctxFor(VALID_LEAD_ID))

    expect(res.status).toBe(403)
    expect(requireUser).not.toHaveBeenCalled()
  })
})

describe('GET /api/leads/[id]/suggestions', () => {
  it('returns 400 when limit exceeds the schema max', async () => {
    vi.mocked(requireUser).mockResolvedValue(actor)
    const req = makeRequest(`${APP_ORIGIN}/api/leads/${VALID_LEAD_ID}/suggestions?limit=500`, { method: 'GET' })

    const res = await suggestionsGet(req, ctxFor(VALID_LEAD_ID))

    expect(res.status).toBe(400)
  })

  it('returns 200 with mapped items and hasLine', async () => {
    vi.mocked(requireUser).mockResolvedValue(actor)
    const row = makeSuggestionRow()
    vi.mocked(listSuggestions).mockResolvedValue({ items: [row as never], hasLine: true })
    const req = makeRequest(`${APP_ORIGIN}/api/leads/${VALID_LEAD_ID}/suggestions?limit=10`, { method: 'GET' })

    const res = await suggestionsGet(req, ctxFor(VALID_LEAD_ID))

    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; hasLine: boolean }
    expect(body.items).toEqual([toSuggestionView(row as never)])
    expect(body.hasLine).toBe(true)
  })
})

describe('POST /api/suggestions/[id]/approve', () => {
  const suggestionId = 'csugg0000000000000000001'

  it('returns 400 when send is missing from the body, and never calls approveSuggestion', async () => {
    vi.mocked(requireUser).mockResolvedValue(actor)
    const req = makeRequest(`${APP_ORIGIN}/api/suggestions/${suggestionId}/approve`, {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({}),
    })

    const res = await approvePost(req, ctxFor(suggestionId))

    expect(res.status).toBe(400)
    expect(approveSuggestion).not.toHaveBeenCalled()
  })

  it('passes a CONFLICT domain error through as 409', async () => {
    vi.mocked(requireUser).mockResolvedValue(actor)
    vi.mocked(approveSuggestion).mockRejectedValue(new DomainError('CONFLICT', 'suggestion is no longer pending'))
    const req = makeRequest(`${APP_ORIGIN}/api/suggestions/${suggestionId}/approve`, {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ send: false, applyScore: false }),
    })

    const res = await approvePost(req, ctxFor(suggestionId))

    expect(res.status).toBe(409)
  })

  it('passes an UNPROCESSABLE domain error through as 422', async () => {
    vi.mocked(requireUser).mockResolvedValue(actor)
    vi.mocked(approveSuggestion).mockRejectedValue(new DomainError('UNPROCESSABLE', 'no reply text'))
    const req = makeRequest(`${APP_ORIGIN}/api/suggestions/${suggestionId}/approve`, {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ send: true, applyScore: false }),
    })

    const res = await approvePost(req, ctxFor(suggestionId))

    expect(res.status).toBe(422)
  })

  it('returns 200 with the suggestion and message view shapes', async () => {
    vi.mocked(requireUser).mockResolvedValue(actor)
    const row = makeSuggestionRow({ status: 'APPROVED' })
    const message = {
      id: 'cmsg00000000000000000001',
      status: 'SENT',
      attemptCount: 1,
      lastError: null,
      sentAt: new Date('2026-09-15T00:00:00.000Z'),
      createdAt: new Date('2026-09-15T00:00:00.000Z'),
    }
    vi.mocked(approveSuggestion).mockResolvedValue({ suggestion: row as never, message: message as never })
    const req = makeRequest(`${APP_ORIGIN}/api/suggestions/${suggestionId}/approve`, {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ send: true, applyScore: false }),
    })

    const res = await approvePost(req, ctxFor(suggestionId))

    expect(res.status).toBe(200)
    const body = (await res.json()) as { suggestion: unknown; message: unknown }
    expect(body.suggestion).toEqual(toSuggestionView(row as never))
    expect(body.message).toEqual(toApprovedMessageView(message as never))
  })

  it('returns a null message when approveSuggestion resolves no message', async () => {
    vi.mocked(requireUser).mockResolvedValue(actor)
    const row = makeSuggestionRow({ status: 'APPROVED' })
    vi.mocked(approveSuggestion).mockResolvedValue({ suggestion: row as never, message: null })
    const req = makeRequest(`${APP_ORIGIN}/api/suggestions/${suggestionId}/approve`, {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ send: false, applyScore: false }),
    })

    const res = await approvePost(req, ctxFor(suggestionId))

    const body = (await res.json()) as { message: unknown }
    expect(body.message).toBeNull()
  })
})

describe('POST /api/suggestions/[id]/reject', () => {
  const suggestionId = 'csugg0000000000000000002'

  it('returns 200 with the rejected suggestion, passing the reason through', async () => {
    vi.mocked(requireUser).mockResolvedValue(actor)
    const row = makeSuggestionRow({ status: 'REJECTED' })
    vi.mocked(rejectSuggestion).mockResolvedValue(row as never)
    const req = makeRequest(`${APP_ORIGIN}/api/suggestions/${suggestionId}/reject`, {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ reason: 'not now' }),
    })

    const res = await rejectPost(req, ctxFor(suggestionId))

    expect(res.status).toBe(200)
    const body = (await res.json()) as { suggestion: unknown }
    expect(body.suggestion).toEqual(toSuggestionView(row as never))
    expect(rejectSuggestion).toHaveBeenCalledWith({ suggestionId, actor, reason: 'not now' })
  })
})
