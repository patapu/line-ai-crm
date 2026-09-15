import type { ActivityType, LeadSource, LeadStage } from '@/lib/generated/prisma/client'
import type { CopilotOutput } from '@/lib/contracts/copilot'

// [F] modules/copilot/types.ts: see docs/design.md section 4.
//
// CopilotOutputSchema and NextBestActionSchema live in
// lib/contracts/copilot.ts. This file re-exports CopilotOutput as a type and
// NextBestActionSchema as a value, and re-exports SuggestDeps from
// ./fallback, so callers can import the copilot module's public surface from
// one place.
export type { CopilotOutput }
export { NextBestActionSchema } from '@/lib/contracts/copilot'
export type { SuggestDeps } from './fallback'

export interface LeadContext {
  lead: {
    id: string
    title: string
    stage: LeadStage
    source: LeadSource
    value: number | null
    currency: string
    stageChangedAt: string
    createdAt: string
    ownerName: string
  }
  contact: {
    firstName: string
    lastName: string | null
    hasLine: boolean
    companyName: string | null
    tags: string[]
  } // NO email/phone to the model
  recentMessages: Array<{
    at: string
    direction: 'INBOUND' | 'OUTBOUND'
    channel: 'LINE' | 'MANUAL'
    text: string
  }> // last 20, each <= 500 chars
  recentActivities: Array<{ at: string; type: ActivityType; text: string | null }> // last 20
  now: string
  replyLocale: 'th' | 'en'
}

export type CopilotErrorCode = 'TIMEOUT' | 'PROVIDER_ERROR' | 'SCHEMA_INVALID' | 'NO_API_KEY' | 'GUARDRAIL_BLOCKED'

export interface CopilotResult {
  output: CopilotOutput
  source: 'MODEL' | 'FALLBACK'
  lowConfidence: boolean
  errorCode: CopilotErrorCode | null
  model: string | null
  promptVersion: string
  latencyMs: number
}

export interface CrmCopilot {
  readonly model: string
  /** Throws on any failure. The wrapper owns fallback. */
  suggest(ctx: LeadContext, signal: AbortSignal): Promise<CopilotOutput>
}
