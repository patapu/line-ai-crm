import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { ZodError, z } from 'zod'
import { APICallError, JSONParseError, NoOutputGeneratedError, RetryError, TypeValidationError } from 'ai'
import { CopilotOutputSchema } from '@/lib/contracts/copilot'
import { ruleBasedSuggestion, applyGuardrails, suggestWithFallback } from '@/modules/copilot/fallback'
import { PROMPT_VERSION } from '@/modules/copilot/instructions'
import type { CopilotOutput, CrmCopilot, LeadContext, SuggestDeps } from '@/modules/copilot/types'

// [D] modules/copilot/fallback.test.ts (G2). No DB, no network. See
// docs/design.md section 4 and S4-plan.md section G2.

const DAY_MS = 86_400_000
const NOW_ISO = '2026-09-15T00:00:00.000Z'
const NOW_MS = Date.parse(NOW_ISO)

function daysAgoIso(days: number): string {
  return new Date(NOW_MS - days * DAY_MS).toISOString()
}

function makeCtx(overrides: Partial<LeadContext> = {}): LeadContext {
  return {
    lead: {
      id: 'clead00000000000000000001',
      title: 'Website inquiry',
      stage: 'QUALIFIED',
      source: 'WEBSITE',
      value: null,
      currency: 'THB',
      stageChangedAt: daysAgoIso(5),
      createdAt: daysAgoIso(10),
      ownerName: 'Owner',
    },
    contact: {
      firstName: 'Nok',
      lastName: null,
      hasLine: true,
      companyName: null,
      tags: [],
    },
    recentMessages: [],
    recentActivities: [],
    now: NOW_ISO,
    replyLocale: 'th',
    ...overrides,
  }
}

function outbound(text: string, daysAgo: number): LeadContext['recentMessages'][number] {
  return { at: daysAgoIso(daysAgo), direction: 'OUTBOUND', channel: 'LINE', text }
}

function inbound(text: string, daysAgo: number): LeadContext['recentMessages'][number] {
  return { at: daysAgoIso(daysAgo), direction: 'INBOUND', channel: 'LINE', text }
}

function makeValidOutput(overrides: Partial<CopilotOutput> = {}): CopilotOutput {
  return {
    summary: 'A short summary of the lead.',
    score: 70,
    scoreReasons: ['Stage QUALIFIED: base score 45'],
    nextBestAction: {
      type: 'SEND_PROPOSAL',
      title: 'Send a proposal',
      rationale: 'Lead is qualified.',
      suggestedStage: 'PROPOSAL',
      dueInDays: 3,
    },
    draftReply: { text: 'สวัสดีค่ะ ขอบคุณที่ติดต่อมานะคะ', locale: 'th' },
    confidence: 0.8,
    flags: [],
    ...overrides,
  }
}

function makeCopilot(suggest: CrmCopilot['suggest'], model = 'gemini-flash-latest'): CrmCopilot {
  return { model, suggest }
}

function makeDeps(overrides: Partial<SuggestDeps> = {}): SuggestDeps {
  return { copilot: null, timeoutMs: 8000, minConfidence: 0.5, ...overrides }
}

describe('ruleBasedSuggestion: base score per stage', () => {
  it.each([
    ['NEW', 20],
    ['QUALIFIED', 45],
    ['PROPOSAL', 65],
    ['WON', 100],
    ['LOST', 0],
  ] as const)('stage %s -> base score %d', (stage, base) => {
    const ctx = makeCtx({ lead: { ...makeCtx().lead, stage } })
    const out = ruleBasedSuggestion(ctx)
    expect(out.score).toBe(base)
    expect(out.scoreReasons[0]).toBe(`Stage ${stage}: base score ${base}`)
  })
})

describe('ruleBasedSuggestion: recency and value adjustments', () => {
  it('adds +15 for an inbound message within the last 3 days', () => {
    const ctx = makeCtx({ recentMessages: [inbound('สวัสดีค่ะ', 2)] })
    const out = ruleBasedSuggestion(ctx)
    expect(out.score).toBe(45 + 15)
    expect(out.scoreReasons).toContain('Customer messaged in the last 3 days (+15)')
  })

  it('does not add +15 for an inbound message 4 days ago', () => {
    const ctx = makeCtx({ recentMessages: [inbound('สวัสดีค่ะ', 4)] })
    const out = ruleBasedSuggestion(ctx)
    expect(out.score).toBe(45)
    expect(out.scoreReasons).not.toContain('Customer messaged in the last 3 days (+15)')
  })

  it('never counts an outbound message towards the recent-engagement bonus', () => {
    const ctx = makeCtx({ recentMessages: [outbound('สวัสดีค่ะ', 1)] })
    const out = ruleBasedSuggestion(ctx)
    expect(out.score).toBe(45)
    expect(out.scoreReasons).not.toContain('Customer messaged in the last 3 days (+15)')
  })

  it('adds +10 when lead.value is set', () => {
    const ctx = makeCtx({ lead: { ...makeCtx().lead, value: 45000 } })
    const out = ruleBasedSuggestion(ctx)
    expect(out.score).toBe(45 + 10)
    expect(out.scoreReasons).toContain('Deal value is set (+10)')
  })

  it('subtracts 15 when there has been no activity for more than 14 days', () => {
    const ctx = makeCtx({ recentMessages: [outbound('เมื่อนานมาแล้ว', 20)] })
    const out = ruleBasedSuggestion(ctx)
    expect(out.score).toBe(45 - 15)
    expect(out.scoreReasons.some((r) => r.includes('No activity for'))).toBe(true)
  })

  it('falls back to lead.createdAt as the last touch when there are no messages or activities', () => {
    const ctx = makeCtx({ lead: { ...makeCtx().lead, createdAt: daysAgoIso(20) } })
    const out = ruleBasedSuggestion(ctx)
    expect(out.score).toBe(45 - 15)
  })

  it('clamps WON + a set value to 100 instead of overflowing', () => {
    const ctx = makeCtx({ lead: { ...makeCtx().lead, stage: 'WON', value: 45000 } })
    const out = ruleBasedSuggestion(ctx)
    expect(out.score).toBe(100)
  })

  it('scoreReasons has exactly one entry per fired adjustment plus the base reason', () => {
    const ctx = makeCtx({
      lead: { ...makeCtx().lead, value: 45000 },
      recentMessages: [inbound('สวัสดีค่ะ', 1)],
    })
    const out = ruleBasedSuggestion(ctx)
    // base + recent-engagement + value-set = 3 reasons, no stale adjustment fires
    expect(out.scoreReasons).toHaveLength(3)
  })
})

describe('ruleBasedSuggestion: draft template', () => {
  it('is null when the contact has no LINE', () => {
    const ctx = makeCtx({ contact: { ...makeCtx().contact, hasLine: false } })
    expect(ruleBasedSuggestion(ctx).draftReply).toBeNull()
  })

  it('the th template contains the first name', () => {
    const ctx = makeCtx({ contact: { ...makeCtx().contact, firstName: 'Nok' }, replyLocale: 'th' })
    const draft = ruleBasedSuggestion(ctx).draftReply
    expect(draft?.locale).toBe('th')
    expect(draft?.text).toContain('Nok')
  })

  it('the en template contains the first name', () => {
    const ctx = makeCtx({ contact: { ...makeCtx().contact, firstName: 'Daniel' }, replyLocale: 'en' })
    const draft = ruleBasedSuggestion(ctx).draftReply
    expect(draft?.locale).toBe('en')
    expect(draft?.text).toContain('Daniel')
  })
})

describe('ruleBasedSuggestion: confidence and flags', () => {
  it('confidence is always 0.3', () => {
    expect(ruleBasedSuggestion(makeCtx()).confidence).toBe(0.3)
  })

  it('flags INSUFFICIENT_CONTEXT when there are no messages and no activity text', () => {
    const ctx = makeCtx({ recentMessages: [], recentActivities: [{ at: daysAgoIso(1), type: 'LEAD_CREATED', text: null }] })
    expect(ruleBasedSuggestion(ctx).flags).toContain('INSUFFICIENT_CONTEXT')
  })

  it('does not flag INSUFFICIENT_CONTEXT when there is at least one message', () => {
    const ctx = makeCtx({ recentMessages: [inbound('สวัสดีค่ะ', 1)] })
    expect(ruleBasedSuggestion(ctx).flags).not.toContain('INSUFFICIENT_CONTEXT')
  })
})

const activityTypeArb = fc.constantFrom('LEAD_CREATED', 'STAGE_CHANGED', 'NOTE', 'CALL', 'MEETING', 'EMAIL') as fc.Arbitrary<
  LeadContext['recentActivities'][number]['type']
>

const messageArb = fc
  .record({
    daysAgo: fc.integer({ min: 0, max: 60 }),
    direction: fc.constantFrom('INBOUND', 'OUTBOUND') as fc.Arbitrary<'INBOUND' | 'OUTBOUND'>,
    channel: fc.constantFrom('LINE', 'MANUAL') as fc.Arbitrary<'LINE' | 'MANUAL'>,
    text: fc.string({ maxLength: 200 }),
  })
  .map(({ daysAgo, direction, channel, text }) => ({ at: daysAgoIso(daysAgo), direction, channel, text }))

const activityArb = fc
  .record({
    daysAgo: fc.integer({ min: 0, max: 60 }),
    type: activityTypeArb,
    text: fc.option(fc.string({ maxLength: 200 }), { nil: null }),
  })
  .map(({ daysAgo, type, text }) => ({ at: daysAgoIso(daysAgo), type, text }))

const ctxArb: fc.Arbitrary<LeadContext> = fc.record({
  stage: fc.constantFrom('NEW', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST') as fc.Arbitrary<LeadContext['lead']['stage']>,
  source: fc.constantFrom('WEBSITE', 'MANUAL', 'LINE') as fc.Arbitrary<LeadContext['lead']['source']>,
  value: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: null }),
  title: fc.string({ minLength: 1, maxLength: 40 }),
  createdDaysAgo: fc.integer({ min: 0, max: 365 }),
  firstName: fc.string({ minLength: 1, maxLength: 20 }),
  lastName: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
  hasLine: fc.boolean(),
  companyName: fc.option(fc.string({ maxLength: 30 }), { nil: null }),
  tags: fc.array(fc.string({ maxLength: 10 }), { maxLength: 3 }),
  recentMessages: fc.array(messageArb, { maxLength: 5 }),
  recentActivities: fc.array(activityArb, { maxLength: 5 }),
  replyLocale: fc.constantFrom('th', 'en') as fc.Arbitrary<'th' | 'en'>,
}).map((r) => ({
  lead: {
    id: 'clead00000000000000000001',
    title: r.title,
    stage: r.stage,
    source: r.source,
    value: r.value,
    currency: 'THB',
    stageChangedAt: daysAgoIso(r.createdDaysAgo),
    createdAt: daysAgoIso(r.createdDaysAgo),
    ownerName: 'Owner',
  },
  contact: {
    firstName: r.firstName,
    lastName: r.lastName,
    hasLine: r.hasLine,
    companyName: r.companyName,
    tags: r.tags,
  },
  recentMessages: r.recentMessages,
  recentActivities: r.recentActivities,
  now: NOW_ISO,
  replyLocale: r.replyLocale,
}))

describe('ruleBasedSuggestion: property', () => {
  it('always produces output that satisfies CopilotOutputSchema, with score in [0, 100]', () => {
    fc.assert(
      fc.property(ctxArb, (ctx) => {
        const out = ruleBasedSuggestion(ctx)
        expect(() => CopilotOutputSchema.parse(out)).not.toThrow()
        expect(out.score).toBeGreaterThanOrEqual(0)
        expect(out.score).toBeLessThanOrEqual(100)
      }),
    )
  })
})

describe('applyGuardrails', () => {
  it('does not mutate its input', () => {
    const ctx = makeCtx()
    const out = makeValidOutput({ score: 42, draftReply: { text: 'safe text', locale: 'th' } })
    const snapshot = structuredClone(out)
    applyGuardrails(out, ctx)
    expect(out).toEqual(snapshot)
  })

  it('replaces a blocked draft with the guardrail-safe template', () => {
    const ctx = makeCtx()
    const out = makeValidOutput({ draftReply: { text: 'ไปที่ www.example.com นะคะ', locale: 'th' } })
    const { output, blocked } = applyGuardrails(out, ctx)
    expect(blocked).toContain('URL')
    expect(output.draftReply?.text).not.toContain('www.example.com')
  })

  it('keeps an unblocked draft unchanged', () => {
    const ctx = makeCtx()
    const out = makeValidOutput({ draftReply: { text: 'ขอบคุณค่ะ', locale: 'th' } })
    const { output, blocked } = applyGuardrails(out, ctx)
    expect(blocked).toHaveLength(0)
    expect(output.draftReply).toEqual({ text: 'ขอบคุณค่ะ', locale: 'th' })
  })

  it('clamps an out-of-range score', () => {
    const ctx = makeCtx()
    const out = makeValidOutput({ score: 150 })
    const { output } = applyGuardrails(out, ctx)
    expect(output.score).toBe(100)
  })

  it('nulls the draft and blocks nothing when the contact has no LINE (S11 fix pass 1)', () => {
    const ctx = makeCtx({ contact: { ...makeCtx().contact, hasLine: false } })
    const out = makeValidOutput({ draftReply: { text: 'safe text', locale: 'th' } })
    const { output, blocked } = applyGuardrails(out, ctx)
    expect(output.draftReply).toBeNull()
    expect(blocked).toEqual([])
  })

  it('blocks with LOCALE_MISMATCH and replaces the draft when its locale differs from ctx.replyLocale (S11 fix pass 1)', () => {
    const ctx = makeCtx({ replyLocale: 'th' })
    const out = makeValidOutput({ draftReply: { text: 'Hi there, thanks for reaching out.', locale: 'en' } })
    const { output, blocked } = applyGuardrails(out, ctx)
    expect(blocked).toContain('LOCALE_MISMATCH')
    expect(output.draftReply?.locale).toBe('th')
    expect(output.draftReply?.text).not.toBe('Hi there, thanks for reaching out.')
  })
})

describe('suggestWithFallback: NO_API_KEY', () => {
  it('returns a FALLBACK result with a null model when deps.copilot is null', async () => {
    const ctx = makeCtx()
    const result = await suggestWithFallback(ctx, makeDeps({ copilot: null }))
    expect(result.source).toBe('FALLBACK')
    expect(result.errorCode).toBe('NO_API_KEY')
    expect(result.model).toBeNull()
    expect(result.promptVersion).toBe('rules-v1')
  })
})

describe('suggestWithFallback: MODEL success', () => {
  it('returns a MODEL result with the copilot model and PROMPT_VERSION', async () => {
    const ctx = makeCtx()
    const copilot = makeCopilot(async () => makeValidOutput())
    const result = await suggestWithFallback(ctx, makeDeps({ copilot }))
    expect(result.source).toBe('MODEL')
    expect(result.errorCode).toBeNull()
    expect(result.model).toBe('gemini-flash-latest')
    expect(result.promptVersion).toBe(PROMPT_VERSION)
  })
})

describe('suggestWithFallback: error classification', () => {
  it('classifies NoOutputGeneratedError as SCHEMA_INVALID', async () => {
    const ctx = makeCtx()
    const copilot = makeCopilot(async () => {
      throw new NoOutputGeneratedError({ message: 'no output' })
    })
    const result = await suggestWithFallback(ctx, makeDeps({ copilot }))
    expect(result.errorCode).toBe('SCHEMA_INVALID')
    expect(result.source).toBe('FALLBACK')
  })

  it('classifies TypeValidationError as SCHEMA_INVALID', async () => {
    const ctx = makeCtx()
    const copilot = makeCopilot(async () => {
      throw new TypeValidationError({ value: {}, cause: new Error('bad shape') })
    })
    const result = await suggestWithFallback(ctx, makeDeps({ copilot }))
    expect(result.errorCode).toBe('SCHEMA_INVALID')
  })

  it('classifies JSONParseError as SCHEMA_INVALID', async () => {
    const ctx = makeCtx()
    const copilot = makeCopilot(async () => {
      throw new JSONParseError({ text: '{ bad json', cause: new Error('parse error') })
    })
    const result = await suggestWithFallback(ctx, makeDeps({ copilot }))
    expect(result.errorCode).toBe('SCHEMA_INVALID')
  })

  it('classifies a ZodError as SCHEMA_INVALID', async () => {
    const ctx = makeCtx()
    const copilot = makeCopilot(async () => {
      try {
        z.string().parse(123)
      } catch (err) {
        throw err as ZodError
      }
      throw new Error('unreachable')
    })
    const result = await suggestWithFallback(ctx, makeDeps({ copilot }))
    expect(result.errorCode).toBe('SCHEMA_INVALID')
  })

  it('classifies a schema-invalid resolved object (score out of range) as SCHEMA_INVALID', async () => {
    const ctx = makeCtx()
    const copilot = makeCopilot(async () => makeValidOutput({ score: 150 }))
    const result = await suggestWithFallback(ctx, makeDeps({ copilot }))
    expect(result.errorCode).toBe('SCHEMA_INVALID')
    expect(result.source).toBe('FALLBACK')
  })

  it('classifies a generic thrown Error as PROVIDER_ERROR', async () => {
    const ctx = makeCtx()
    const copilot = makeCopilot(async () => {
      throw new Error('boom')
    })
    const result = await suggestWithFallback(ctx, makeDeps({ copilot }))
    expect(result.errorCode).toBe('PROVIDER_ERROR')
  })

  it('classifies a synchronous throw inside suggest as PROVIDER_ERROR', async () => {
    const ctx = makeCtx()
    const copilot: CrmCopilot = {
      model: 'gemini-flash-latest',
      suggest: () => {
        throw new Error('sync boom')
      },
    }
    const result = await suggestWithFallback(ctx, makeDeps({ copilot }))
    expect(result.errorCode).toBe('PROVIDER_ERROR')
    expect(result.source).toBe('FALLBACK')
  })

  it('classifies an error named TimeoutError thrown directly as TIMEOUT', async () => {
    const ctx = makeCtx()
    const copilot = makeCopilot(async () => {
      const err = new Error('provider timed out')
      err.name = 'TimeoutError'
      throw err
    })
    const result = await suggestWithFallback(ctx, makeDeps({ copilot }))
    expect(result.errorCode).toBe('TIMEOUT')
  })

  it('classifies a RetryError wrapping a TimeoutError as TIMEOUT', async () => {
    const ctx = makeCtx()
    const timeoutErr = new Error('timed out')
    timeoutErr.name = 'TimeoutError'
    const copilot = makeCopilot(async () => {
      throw new RetryError({ message: 'retries exhausted', reason: 'maxRetriesExceeded', errors: [timeoutErr] })
    })
    const result = await suggestWithFallback(ctx, makeDeps({ copilot }))
    expect(result.errorCode).toBe('TIMEOUT')
  })

  it('reports the APICallError status code on the fallback_used log line', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const ctx = makeCtx()
    const apiErr = new APICallError({
      message: 'provider 503',
      url: 'https://example.invalid',
      requestBodyValues: {},
      statusCode: 503,
      isRetryable: true,
    })
    const copilot = makeCopilot(async () => {
      throw apiErr
    })
    await suggestWithFallback(ctx, makeDeps({ copilot }))
    const fallbackLine = logSpy.mock.calls.map((c) => c[0] as string).find((l) => l.includes('copilot.fallback_used'))
    logSpy.mockRestore()
    expect(fallbackLine).toBeDefined()
    expect(JSON.parse(fallbackLine as string).httpStatus).toBe(503)
  })
})

describe('suggestWithFallback: timeout race', () => {
  it('times out and aborts the signal when the copilot hangs past deps.timeoutMs', async () => {
    let capturedSignal: AbortSignal | undefined
    const copilot: CrmCopilot = {
      model: 'gemini-flash-latest',
      suggest: (_ctx, signal) => {
        capturedSignal = signal
        return new Promise(() => {})
      },
    }
    const ctx = makeCtx()
    const result = await suggestWithFallback(ctx, makeDeps({ copilot, timeoutMs: 30 }))
    expect(result.errorCode).toBe('TIMEOUT')
    expect(result.source).toBe('FALLBACK')
    expect(capturedSignal?.aborted).toBe(true)
  }, 2000)
})

describe('suggestWithFallback: lowConfidence', () => {
  it('is low confidence when the model confidence is below deps.minConfidence', async () => {
    const ctx = makeCtx()
    const copilot = makeCopilot(async () => makeValidOutput({ confidence: 0.4 }))
    const result = await suggestWithFallback(ctx, makeDeps({ copilot, minConfidence: 0.5 }))
    expect(result.source).toBe('MODEL')
    expect(result.lowConfidence).toBe(true)
  })

  it('is low confidence when INSUFFICIENT_CONTEXT is flagged even at high confidence', async () => {
    const ctx = makeCtx()
    const copilot = makeCopilot(async () => makeValidOutput({ confidence: 0.9, flags: ['INSUFFICIENT_CONTEXT'] }))
    const result = await suggestWithFallback(ctx, makeDeps({ copilot, minConfidence: 0.5 }))
    expect(result.lowConfidence).toBe(true)
  })
})

describe('suggestWithFallback: guardrail blocking a model draft', () => {
  it('replaces a URL-bearing model draft with the template and marks GUARDRAIL_BLOCKED', async () => {
    const ctx = makeCtx()
    const modelOutput = makeValidOutput({
      summary: 'Model summary kept as-is.',
      draftReply: { text: 'ดูรายละเอียดที่ www.example.com นะคะ', locale: 'th' },
    })
    const copilot = makeCopilot(async () => modelOutput)
    const result = await suggestWithFallback(ctx, makeDeps({ copilot }))

    expect(result.source).toBe('MODEL')
    expect(result.errorCode).toBe('GUARDRAIL_BLOCKED')
    expect(result.lowConfidence).toBe(true)
    expect(result.output.draftReply?.text).not.toContain('www.example.com')
    expect(result.output.summary).toBe('Model summary kept as-is.')
  })
})

describe('suggestWithFallback: last-resort path cannot throw (S11 fix pass 1)', () => {
  it('falls back to the hard-coded last resort when ruleBasedSuggestion itself throws, and the result still satisfies CopilotOutputSchema', async () => {
    const badCtx = makeCtx({
      lead: { ...makeCtx().lead, stage: 'UNKNOWN_STAGE' as LeadContext['lead']['stage'] },
    }) as unknown as LeadContext
    const copilot: CrmCopilot = {
      model: 'gemini-flash-latest',
      suggest: async () => {
        throw new Error('provider boom')
      },
    }

    const result = await suggestWithFallback(badCtx, makeDeps({ copilot }))

    expect(result.source).toBe('FALLBACK')
    expect(result.errorCode).toBe('PROVIDER_ERROR')
    expect(result.model).toBeNull()
    expect(result.output.draftReply).toBeNull()
    expect(() => CopilotOutputSchema.parse(result.output)).not.toThrow()
  })

  it('never rejects even when both the model call and the rule-based fallback fail', async () => {
    const badCtx = makeCtx({
      lead: { ...makeCtx().lead, stage: 'UNKNOWN_STAGE' as LeadContext['lead']['stage'] },
    }) as unknown as LeadContext

    await expect(suggestWithFallback(badCtx, makeDeps({ copilot: null }))).resolves.toBeDefined()
  })
})

describe('suggestWithFallback: last-resort output confidence (S12 MINOR)', () => {
  it('the last-resort output confidence equals FALLBACK_CONFIDENCE (0.3), not 0', async () => {
    const badCtx = makeCtx({
      lead: { ...makeCtx().lead, stage: 'UNKNOWN_STAGE' as LeadContext['lead']['stage'] },
    }) as unknown as LeadContext
    const copilot: CrmCopilot = {
      model: 'gemini-flash-latest',
      suggest: async () => {
        throw new Error('provider boom')
      },
    }

    const result = await suggestWithFallback(badCtx, makeDeps({ copilot }))

    expect(result.output.confidence).toBe(0.3)
  })
})

describe('suggestWithFallback: last-resort path survives a missing ctx.lead (S12 NIT)', () => {
  it('does not reject when ctx.lead is undefined and deps.copilot is null', async () => {
    const badCtx = { ...makeCtx(), lead: undefined } as unknown as LeadContext

    await expect(suggestWithFallback(badCtx, makeDeps({ copilot: null }))).resolves.toBeDefined()
  })

  it('does not reject when ctx.lead is undefined and the copilot throws', async () => {
    const badCtx = { ...makeCtx(), lead: undefined } as unknown as LeadContext
    const copilot: CrmCopilot = {
      model: 'gemini-flash-latest',
      suggest: async () => {
        throw new Error('provider boom')
      },
    }

    await expect(suggestWithFallback(badCtx, makeDeps({ copilot }))).resolves.toBeDefined()
  })

  // Covers the `ctx?.lead?.id ?? null` read in safeFallback's crash log
  // directly (not just "it resolves"): ctx.lead is undefined here, so a bare
  // `ctx.lead.id` would itself throw inside the catch block's log call. If
  // that ever regressed, this test would fail with an unhandled rejection
  // instead of the assertions below ever running.
  it('logs copilot.fallback_crashed with leadId null instead of throwing on ctx.lead.id (S12 NIT)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const badCtx = { ...makeCtx(), lead: undefined } as unknown as LeadContext

    const result = await suggestWithFallback(badCtx, makeDeps({ copilot: null }))

    const crashLines = errorSpy.mock.calls
      .map((c) => c[0] as string)
      .filter((line) => line.includes('copilot.fallback_crashed'))
    errorSpy.mockRestore()

    expect(crashLines).toHaveLength(1)
    const parsed = JSON.parse(crashLines[0]) as { leadId: unknown; errName: unknown }
    expect(parsed.leadId).toBeNull()
    expect(parsed.errName).toBe('TypeError')
    expect(result.errorCode).toBe('NO_API_KEY')
  })
})

describe('suggestWithFallback: copilot.fallback_crashed log shape (S17/S18 T1)', () => {
  it('logs errorCode, attemptedModel and causeErrName, with no text/draft/summary key', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const badCtx = makeCtx({
      lead: { ...makeCtx().lead, stage: 'UNKNOWN_STAGE' as LeadContext['lead']['stage'] },
    }) as unknown as LeadContext
    const copilot: CrmCopilot = {
      model: 'gemini-flash-latest',
      suggest: async () => {
        const err = new Error('provider boom')
        err.name = 'TimeoutError'
        throw err
      },
    }

    const result = await suggestWithFallback(badCtx, makeDeps({ copilot, timeoutMs: 30 }))

    const crashLines = errorSpy.mock.calls.map((c) => c[0] as string).filter((line) => line.includes('copilot.fallback_crashed'))
    errorSpy.mockRestore()

    expect(crashLines).toHaveLength(1)
    const parsed = JSON.parse(crashLines[0]) as Record<string, unknown>

    expect(parsed).toHaveProperty('errorCode')
    expect(parsed).toHaveProperty('attemptedModel')
    expect(parsed).toHaveProperty('causeErrName')
    expect(parsed.attemptedModel).toBe('gemini-flash-latest')
    expect(parsed.errorCode).toBe(result.errorCode)

    expect(parsed).not.toHaveProperty('text')
    expect(parsed).not.toHaveProperty('draft')
    expect(parsed).not.toHaveProperty('draftReply')
    expect(parsed).not.toHaveProperty('summary')
  })

  it('causeErrName reflects the original error passed into the fallback path (not the rule-based crash)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const badCtx = makeCtx({
      lead: { ...makeCtx().lead, stage: 'UNKNOWN_STAGE' as LeadContext['lead']['stage'] },
    }) as unknown as LeadContext
    const copilot: CrmCopilot = {
      model: 'gemini-flash-latest',
      suggest: async () => {
        throw new Error('provider boom')
      },
    }

    await suggestWithFallback(badCtx, makeDeps({ copilot }))

    const crashLines = errorSpy.mock.calls.map((c) => c[0] as string).filter((line) => line.includes('copilot.fallback_crashed'))
    errorSpy.mockRestore()

    expect(crashLines).toHaveLength(1)
    const parsed = JSON.parse(crashLines[0]) as { causeErrName: unknown; errName: unknown }
    expect(parsed.causeErrName).toBe('Error')
  })

  it('no key in the crashed log line matches the lib/log.ts secret-shaped redaction pattern', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const badCtx = makeCtx({
      lead: { ...makeCtx().lead, stage: 'UNKNOWN_STAGE' as LeadContext['lead']['stage'] },
    }) as unknown as LeadContext

    await suggestWithFallback(badCtx, makeDeps({ copilot: null }))

    const crashLines = errorSpy.mock.calls.map((c) => c[0] as string).filter((line) => line.includes('copilot.fallback_crashed'))
    errorSpy.mockRestore()

    expect(crashLines).toHaveLength(1)
    const parsed = JSON.parse(crashLines[0]) as Record<string, unknown>
    const REDACT_KEY_RE = /secret|token|signature|password|apikey|api_key|authorization|cookie|email|phone|url$|dsn|connection|databaseurl/i
    for (const key of Object.keys(parsed)) {
      expect(REDACT_KEY_RE.test(key)).toBe(false)
    }
  })
})

describe('suggestWithFallback: last-resort output is built fresh each call (S17/S18 T9)', () => {
  async function triggerLastResort(): Promise<CopilotOutput> {
    const badCtx = makeCtx({
      lead: { ...makeCtx().lead, stage: 'UNKNOWN_STAGE' as LeadContext['lead']['stage'] },
    }) as unknown as LeadContext
    const copilot: CrmCopilot = {
      model: 'gemini-flash-latest',
      suggest: async () => {
        throw new Error('provider boom')
      },
    }
    const result = await suggestWithFallback(badCtx, makeDeps({ copilot }))
    return result.output
  }

  it('two calls into the last-resort path return different object references', async () => {
    const first = await triggerLastResort()
    const second = await triggerLastResort()

    expect(first).not.toBe(second)
    expect(first.nextBestAction).not.toBe(second.nextBestAction)
    expect(first.scoreReasons).not.toBe(second.scoreReasons)
    expect(first.flags).not.toBe(second.flags)
  })

  it('mutating one last-resort output does not affect the next call', async () => {
    const first = await triggerLastResort()
    first.scoreReasons.push('mutated by test')
    first.flags.push('PRICING_REQUESTED')
    ;(first as { summary: string }).summary = 'mutated by test'

    const second = await triggerLastResort()

    expect(second.scoreReasons).not.toContain('mutated by test')
    expect(second.flags).not.toContain('PRICING_REQUESTED')
    expect(second.summary).toBe('AI suggestion unavailable right now.')
  })
})

describe('suggestWithFallback: NO_API_KEY code preserved when the rule-based fallback itself throws (S12 NIT)', () => {
  it('keeps errorCode NO_API_KEY instead of PROVIDER_ERROR', async () => {
    const badCtx = makeCtx({
      lead: { ...makeCtx().lead, stage: 'UNKNOWN_STAGE' as LeadContext['lead']['stage'] },
    }) as unknown as LeadContext

    const result = await suggestWithFallback(badCtx, makeDeps({ copilot: null }))

    expect(result.errorCode).toBe('NO_API_KEY')
  })
})

describe('suggestWithFallback: latencyMs', () => {
  it('is a non-negative integer', async () => {
    const ctx = makeCtx()
    const copilot = makeCopilot(async () => makeValidOutput())
    const result = await suggestWithFallback(ctx, makeDeps({ copilot }))
    expect(Number.isInteger(result.latencyMs)).toBe(true)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })
})

describe('suggestWithFallback: log safety', () => {
  it('never logs raw customer message text, and logs a fallback_used line on fallback', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const sentinel = 'SENTINEL-CUSTOMER-SECRET-08123456789-user@example.com'
    const ctx = makeCtx({ recentMessages: [inbound(sentinel, 0)] })

    await suggestWithFallback(ctx, makeDeps({ copilot: null }))

    const lines = logSpy.mock.calls.map((c) => c[0] as string)
    logSpy.mockRestore()

    for (const line of lines) {
      expect(line).not.toContain(sentinel)
    }
    expect(lines.some((l) => l.includes('copilot.fallback_used'))).toBe(true)
    expect(lines.some((l) => l.includes('copilot.suggest'))).toBe(true)
  })
})
