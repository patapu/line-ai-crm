import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { createCrmCopilot, getSuggestDeps } from '@/modules/copilot/model'
import { suggestWithFallback } from '@/modules/copilot/fallback'
import type { CopilotOutput, LeadContext, SuggestDeps } from '@/modules/copilot/types'

// [B] modules/copilot/model.test.ts (G5). No DB, no real network: the model
// is replaced with MockLanguageModelV4 from 'ai/test'. See S4-plan.md
// section G5. `server-only` resolves via vitest.config.ts's alias to
// node_modules/server-only/empty.js, so no vi.mock is needed to import this
// module under vitest.

function makeCtx(overrides: Partial<LeadContext> = {}): LeadContext {
  return {
    lead: {
      id: 'clead00000000000000000001',
      title: 'Website inquiry',
      stage: 'QUALIFIED',
      source: 'WEBSITE',
      value: null,
      currency: 'THB',
      stageChangedAt: '2026-09-01T00:00:00.000Z',
      createdAt: '2026-08-01T00:00:00.000Z',
      ownerName: 'Owner',
    },
    contact: { firstName: 'Nok', lastName: null, hasLine: true, companyName: null, tags: [] },
    recentMessages: [],
    recentActivities: [],
    now: '2026-09-15T00:00:00.000Z',
    replyLocale: 'th',
    ...overrides,
  }
}

function mockGenerateResult(text: string): LanguageModelV4GenerateResult {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 10, text: 10, reasoning: undefined },
    },
    warnings: [],
  }
}

const VALID_OUTPUT: CopilotOutput = {
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
}

describe('createCrmCopilot', () => {
  it('returns null when there is no apiKey and no injected languageModel', () => {
    expect(createCrmCopilot({ apiKey: undefined, modelId: 'gemini-flash-latest', timeoutMs: 8000 })).toBeNull()
  })

  it('uses the injected languageModel test seam and exposes modelId as .model', () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => mockGenerateResult(JSON.stringify(VALID_OUTPUT)),
    })
    const copilot = createCrmCopilot({ apiKey: undefined, modelId: 'test-model', timeoutMs: 8000, languageModel: model })
    expect(copilot).not.toBeNull()
    expect(copilot?.model).toBe('test-model')
  })

  it('suggest() parses a valid JSON model response into a CopilotOutput', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => mockGenerateResult(JSON.stringify(VALID_OUTPUT)),
    })
    const copilot = createCrmCopilot({ apiKey: undefined, modelId: 'test-model', timeoutMs: 8000, languageModel: model })
    const controller = new AbortController()
    const output = await copilot?.suggest(makeCtx(), controller.signal)
    expect(output?.summary).toBe(VALID_OUTPUT.summary)
    expect(output?.score).toBe(70)
    expect(output?.nextBestAction.type).toBe('SEND_PROPOSAL')
  })

  it('rejects when the model returns invalid JSON, and suggestWithFallback turns that into SCHEMA_INVALID', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => mockGenerateResult('{ this is not valid json'),
    })
    const copilot = createCrmCopilot({ apiKey: undefined, modelId: 'test-model', timeoutMs: 8000, languageModel: model })
    const deps: SuggestDeps = { copilot, timeoutMs: 8000, minConfidence: 0.5 }

    const result = await suggestWithFallback(makeCtx(), deps)

    expect(result.source).toBe('FALLBACK')
    expect(result.errorCode).toBe('SCHEMA_INVALID')
    expect(result.model).toBeNull()
  })

  it('rejects when the model returns JSON that fails CopilotOutputSchema, and suggestWithFallback turns that into SCHEMA_INVALID', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => mockGenerateResult(JSON.stringify({ ...VALID_OUTPUT, score: 999 })),
    })
    const copilot = createCrmCopilot({ apiKey: undefined, modelId: 'test-model', timeoutMs: 8000, languageModel: model })
    const deps: SuggestDeps = { copilot, timeoutMs: 8000, minConfidence: 0.5 }

    const result = await suggestWithFallback(makeCtx(), deps)

    expect(result.source).toBe('FALLBACK')
    expect(result.errorCode).toBe('SCHEMA_INVALID')
  })
})

describe('createCrmCopilot: instructions load failure (S11 fix pass 1)', () => {
  afterEach(() => {
    vi.doUnmock('node:fs')
    vi.resetModules()
  })

  it('suggest() rejects with name InstructionsLoadError when instructions.md cannot be read, and never leaks the path/content', async () => {
    vi.resetModules()
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>()
      return {
        ...actual,
        readFileSync: () => {
          throw new Error('ENOENT: no such file or directory')
        },
      }
    })

    const { createCrmCopilot: createCrmCopilotFresh } = await import('@/modules/copilot/model')
    const model = new MockLanguageModelV4({
      doGenerate: async () => mockGenerateResult(JSON.stringify(VALID_OUTPUT)),
    })
    const copilot = createCrmCopilotFresh({ apiKey: undefined, modelId: 'test-model', timeoutMs: 8000, languageModel: model })
    const controller = new AbortController()

    await expect(copilot?.suggest(makeCtx(), controller.signal)).rejects.toMatchObject({ name: 'InstructionsLoadError' })

    try {
      await copilot?.suggest(makeCtx(), controller.signal)
    } catch (err) {
      expect((err as Error).message).not.toContain('ENOENT')
      expect((err as Error).message.toLowerCase()).not.toContain('instructions.md')
    }
  })

  it('suggestWithFallback classifies an InstructionsLoadError as PROVIDER_ERROR without ever throwing, and logs that errName', async () => {
    vi.resetModules()
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>()
      return {
        ...actual,
        readFileSync: () => {
          throw new Error('ENOENT: no such file or directory')
        },
      }
    })

    const { createCrmCopilot: createCrmCopilotFresh } = await import('@/modules/copilot/model')
    const { suggestWithFallback: suggestWithFallbackFresh } = await import('@/modules/copilot/fallback')
    const model = new MockLanguageModelV4({
      doGenerate: async () => mockGenerateResult(JSON.stringify(VALID_OUTPUT)),
    })
    const copilot = createCrmCopilotFresh({ apiKey: undefined, modelId: 'test-model', timeoutMs: 8000, languageModel: model })
    const deps: SuggestDeps = { copilot, timeoutMs: 8000, minConfidence: 0.5 }

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = await suggestWithFallbackFresh(makeCtx(), deps)
    const lines = logSpy.mock.calls.map((c) => c[0] as string)
    logSpy.mockRestore()

    expect(result.source).toBe('FALLBACK')
    expect(result.errorCode).toBe('PROVIDER_ERROR')
    const fallbackLine = lines.find((l) => l.includes('copilot.fallback_used'))
    expect(fallbackLine).toBeDefined()
    expect(JSON.parse(fallbackLine as string).errName).toBe('InstructionsLoadError')
  })
})

describe('getSuggestDeps', () => {
  it('builds SuggestDeps from process env, with a null copilot when no API key is set', () => {
    const deps = getSuggestDeps()
    expect(deps.copilot).toBeNull()
    expect(deps.timeoutMs).toBe(8000)
    expect(deps.minConfidence).toBe(0.5)
  })
})
