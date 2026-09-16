import { describe, expect, it } from 'vitest'
import casesFile from '@/skills/crm-copilot/evals/cases.json'
import {
  EvalFileSchema,
  buildContextFromCase,
  checkExpectations,
  parseMinConfidence,
  type EvalCase,
} from '@/scripts/eval-copilot'
import type { CopilotResult } from '@/modules/copilot/types'

// [D] modules/copilot/eval-cases.test.ts (G8). Importing scripts/eval-copilot.ts
// for its exports has no side effects: main() only runs when this file is the
// process entry point, which it never is under vitest. See S4-plan.md
// section G8 and section F.4.

describe('EvalFileSchema', () => {
  it('parses skills/crm-copilot/evals/cases.json without throwing', () => {
    expect(() => EvalFileSchema.parse(casesFile)).not.toThrow()
  })

  it('has exactly 7 cases with unique ids', () => {
    const file = EvalFileSchema.parse(casesFile)
    expect(file.cases).toHaveLength(7)
    expect(new Set(file.cases.map((c) => c.id)).size).toBe(7)
  })

  it('covers all three buckets', () => {
    const file = EvalFileSchema.parse(casesFile)
    const buckets = new Set(file.cases.map((c) => c.bucket))
    expect(buckets).toEqual(new Set(['easy', 'ambiguous', 'adversarial']))
  })
})

describe('cases.json: specific expectations stay in sync with SKILL.md (S11 fix pass 1)', () => {
  const file = EvalFileSchema.parse(casesFile)

  it('lost-no-push allows only a low score band (scoreMax 30)', () => {
    const c = file.cases.find((cc) => cc.id === 'lost-no-push') as EvalCase
    expect(c.expect.scoreMax).toBe(30)
  })

  it('prompt-injection-discount forbids a bare discount-word draft', () => {
    const c = file.cases.find((cc) => cc.id === 'prompt-injection-discount') as EvalCase
    expect(c.expect.draftNotMatch).toContain('ส่วนลด|discount')
  })
})

describe('buildContextFromCase', () => {
  const file = EvalFileSchema.parse(casesFile)
  const hotPricing = file.cases.find((c) => c.id === 'hot-pricing-th') as EvalCase

  it('builds a LeadContext with the eval-prefixed id and mapped fields', () => {
    const now = new Date('2026-09-15T00:00:00.000Z')
    const ctx = buildContextFromCase(hotPricing, now)

    expect(ctx.lead.id).toBe('eval-hot-pricing-th')
    expect(ctx.lead.value).toBe(45000)
    expect(ctx.recentMessages).toHaveLength(2)
    expect(ctx.recentActivities).toHaveLength(1)
    expect(ctx.now).toBe(now.toISOString())
    for (const m of ctx.recentMessages) {
      expect(Number.isNaN(Date.parse(m.at))).toBe(false)
    }
  })

  it('defaults replyLocale via detectReplyLocale when the case leaves it null', () => {
    const now = new Date('2026-09-15T00:00:00.000Z')
    const ctx = buildContextFromCase(hotPricing, now)
    // hot-pricing-th's only INBOUND message is written in Thai.
    expect(ctx.replyLocale).toBe('th')
  })
})

describe('checkExpectations', () => {
  const file = EvalFileSchema.parse(casesFile)
  const hotPricing = file.cases.find((c) => c.id === 'hot-pricing-th') as EvalCase

  function makeResult(overrides: Partial<CopilotResult> = {}): CopilotResult {
    return {
      output: {
        summary: 'ok',
        score: 90,
        scoreReasons: ['r'],
        nextBestAction: { type: 'SEND_PROPOSAL', title: 't', rationale: 'r', suggestedStage: 'PROPOSAL', dueInDays: 3 },
        draftReply: null,
        confidence: 0.9,
        flags: [],
      },
      source: 'MODEL',
      lowConfidence: false,
      errorCode: null,
      model: 'gemini-flash-latest',
      promptVersion: 'crm-copilot-v1',
      latencyMs: 100,
      ...overrides,
    }
  }

  it('passes (empty failures) for a result that satisfies the case expectations', () => {
    expect(checkExpectations(hotPricing, makeResult())).toEqual([])
  })

  it('flags a crafted result that violates scoreMin and nextBestActionIn', () => {
    const bad = makeResult({
      output: {
        ...makeResult().output,
        score: 10,
        nextBestAction: { type: 'FOLLOW_UP_LATER', title: 't', rationale: 'r', suggestedStage: null, dueInDays: 14 },
      },
    })

    const failures = checkExpectations(hotPricing, bad)

    expect(failures.length).toBeGreaterThan(0)
    expect(failures.some((f) => f.includes('score >='))).toBe(true)
    expect(failures.some((f) => f.includes('nextBestAction'))).toBe(true)
  })

  it('flags a source mismatch', () => {
    const bad = makeResult({ source: 'FALLBACK' })
    const failures = checkExpectations(hotPricing, bad)
    expect(failures.some((f) => f.includes('expected source MODEL'))).toBe(true)
  })
})

describe('parseMinConfidence (extracted from main() for testability, S12)', () => {
  it('defaults to 0.5 when unset (undefined)', () => {
    expect(parseMinConfidence(undefined)).toBe(0.5)
  })

  it('defaults to 0.5 when the env var is set but empty', () => {
    expect(parseMinConfidence('')).toBe(0.5)
  })

  it('parses the literal string "0" as 0, not the empty-string default', () => {
    expect(parseMinConfidence('0')).toBe(0)
  })

  it('parses a normal decimal value', () => {
    expect(parseMinConfidence('0.7')).toBe(0.7)
  })

  // S17/S18 T8: parseMinConfidence must validate the parsed number is finite
  // and within [0, 1], throwing a fixed message that never echoes the raw
  // env value back (so a stray secret-shaped env var never leaks via the
  // exception message/log line).
  it.each(['abc', 'NaN', '1.5', '-0.1'])('throws for the invalid value "%s"', (raw) => {
    expect(() => parseMinConfidence(raw)).toThrow()
  })

  it.each(['abc', 'NaN', '1.5', '-0.1'])('the thrown error message does not echo the raw invalid value "%s"', (raw) => {
    let caught: unknown
    try {
      parseMinConfidence(raw)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    const message = (caught as Error).message
    expect(message).not.toContain(raw)
    expect(message).toBe('COPILOT_MIN_CONFIDENCE must be a number from 0 to 1')
  })

  it('accepts the boundary value 0', () => {
    expect(parseMinConfidence('0')).toBe(0)
  })

  it('accepts the boundary value 1', () => {
    expect(parseMinConfidence('1')).toBe(1)
  })

  it('throws for a value just above the boundary (1.0001)', () => {
    expect(() => parseMinConfidence('1.0001')).toThrow()
  })
})
