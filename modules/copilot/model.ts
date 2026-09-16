import 'server-only'
import { generateText, Output, type LanguageModel } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getEnv } from '@/lib/env'
import { CopilotOutputSchema } from '@/lib/contracts/copilot'
import { renderLeadContext } from '@/modules/copilot/context'
import { loadInstructions } from '@/modules/copilot/instructions'
import type { CrmCopilot, LeadContext, SuggestDeps } from '@/modules/copilot/types'

// [B2] modules/copilot/model.ts: lane owned. See docs/design.md section 4
// ("Lane B ใช้ API ของ `ai` v7 ในรูปนี้"). `server-only` is safe to import
// here: it resolves to an empty module under `tsx --conditions=react-server`
// (scripts/eval-copilot.ts's runner), and fallback.ts / context.ts never
// import this file, so nothing outside a request/eval-script context pulls
// it in by accident.

/**
 * `languageModel` is a test seam (e.g. MockLanguageModelV4 from 'ai/test');
 * production callers only ever pass `apiKey` + `modelId`. Returns null when
 * there is no key and no injected model: `suggestWithFallback` treats a null
 * `copilot` as NO_API_KEY and never calls the model.
 */
export function createCrmCopilot(opts: {
  apiKey: string | undefined
  modelId: string
  timeoutMs: number
  languageModel?: LanguageModel
}): CrmCopilot | null {
  if (!opts.apiKey && !opts.languageModel) return null

  const model = opts.languageModel ?? createGoogleGenerativeAI({ apiKey: opts.apiKey })(opts.modelId)

  return {
    model: opts.modelId,
    async suggest(ctx: LeadContext, signal: AbortSignal) {
      let instructions: string
      try {
        instructions = loadInstructions()
      } catch (err) {
        // A missing/unreadable instructions.md would otherwise surface as a
        // generic PROVIDER_ERROR on every request, indistinguishable from a
        // transient model failure and hiding what is really a deploy
        // problem. Rethrow with a distinct name (never the file path or its
        // content) so copilot.fallback_used's errName says exactly what
        // went wrong; suggestWithFallback still classifies this as
        // PROVIDER_ERROR and still never throws to its own caller.
        const loadError = new Error('failed to load copilot instructions')
        loadError.name = 'InstructionsLoadError'
        loadError.cause = err
        throw loadError
      }

      const result = await generateText({
        model,
        instructions,
        prompt: renderLeadContext(ctx),
        output: Output.object({ schema: CopilotOutputSchema }),
        timeout: { totalMs: opts.timeoutMs },
        maxRetries: 1,
        abortSignal: signal,
      })
      return result.output
    },
  }
}

/** Builds SuggestDeps from process env, for route handlers and requestInsight's default. */
export function getSuggestDeps(): SuggestDeps {
  const env = getEnv()

  return {
    copilot: createCrmCopilot({
      apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
      modelId: env.COPILOT_MODEL,
      timeoutMs: env.COPILOT_TIMEOUT_MS,
    }),
    timeoutMs: env.COPILOT_TIMEOUT_MS,
    minConfidence: env.COPILOT_MIN_CONFIDENCE,
  }
}
