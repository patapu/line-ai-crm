// OWNER: lane B (stub from layer 0)
//
// Signatures frozen per docs/design.md section 4 and the guardrail/fallback
// rules in the surrounding prose (score bands, guardrail checks, the 6
// wrapper rules). Lane B fills in the bodies. `suggestWithFallback` itself
// must never throw once implemented for real: the layer 0 stub throws only
// as a placeholder so nothing calls an unimplemented function silently.

import { DomainError } from '@/lib/errors'
import type { CopilotOutput, CopilotResult, CrmCopilot, LeadContext } from '@/modules/copilot/types'

export interface SuggestDeps {
  copilot: CrmCopilot | null // null when GOOGLE_GENERATIVE_AI_API_KEY is unset
  timeoutMs: number // COPILOT_TIMEOUT_MS, default 8000
  minConfidence: number // COPILOT_MIN_CONFIDENCE, default 0.5
}

export async function suggestWithFallback(ctx: LeadContext, deps: SuggestDeps): Promise<CopilotResult> {
  void ctx
  void deps
  throw new DomainError('INTERNAL', 'not implemented')
}

export function ruleBasedSuggestion(ctx: LeadContext): CopilotOutput {
  void ctx
  throw new DomainError('INTERNAL', 'not implemented')
}

export function applyGuardrails(
  out: CopilotOutput,
  ctx: LeadContext,
): { output: CopilotOutput; blocked: string[] } {
  void out
  void ctx
  throw new DomainError('INTERNAL', 'not implemented')
}
