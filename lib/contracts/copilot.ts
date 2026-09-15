import { z } from 'zod'
import { LeadStageSchema } from '@/lib/contracts/crm'

// [F] lib/contracts/copilot.ts: see docs/design.md section 3 and section 4.
//
// CopilotOutputSchema and NextBestActionSchema are defined here rather than
// in modules/copilot/types.ts, per the layer 0 spec; modules/copilot/types.ts
// re-exports CopilotOutput as a type and NextBestActionSchema as a value.
// Names and shapes match the design doc.

export const InsightRequest = z.object({
  replyLocale: z.enum(['th', 'en']).optional(),
})

export const SuggestionApprove = z.object({
  send: z.boolean(),
  replyText: z.string().trim().min(1).max(1000).optional(),
  applyScore: z.boolean().default(false),
})

export const SuggestionReject = z.object({
  reason: z.string().trim().max(500).optional(),
})

export const NextBestActionSchema = z.object({
  type: z.enum([
    'REPLY_LINE',
    'CALL',
    'SEND_PROPOSAL',
    'SCHEDULE_MEETING',
    'FOLLOW_UP_LATER',
    'MOVE_STAGE',
    'HANDOFF_TO_HUMAN',
    'CLOSE_LOST',
  ]),
  title: z.string().max(120),
  rationale: z.string().max(300),
  suggestedStage: LeadStageSchema.nullable(),
  dueInDays: z.number().int().min(0).max(30).nullable(),
})

export const CopilotOutputSchema = z.object({
  summary: z.string().min(1).max(800),
  score: z.number().int().min(0).max(100),
  scoreReasons: z.array(z.string().max(200)).min(1).max(5),
  nextBestAction: NextBestActionSchema,
  draftReply: z
    .object({ text: z.string().max(500), locale: z.enum(['th', 'en']) })
    .nullable(),
  confidence: z.number().min(0).max(1),
  flags: z
    .array(z.enum(['INSUFFICIENT_CONTEXT', 'PROMPT_INJECTION_SUSPECTED', 'PRICING_REQUESTED', 'COMPLAINT', 'OUT_OF_SCOPE']))
    .max(5),
})

export type CopilotOutput = z.infer<typeof CopilotOutputSchema>
