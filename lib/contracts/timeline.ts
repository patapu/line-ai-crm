import { z } from 'zod'
import type { ActivityType, MessageStatus } from '@/lib/generated/prisma/client'

// [F] lib/contracts/timeline.ts: see docs/design.md section 3.
//
// ActivityType and MessageStatus are exported as TS enum/union types from
// `@/lib/generated/prisma/client` (same generated output as lib/db.ts
// imports from).

export const TimelineQuery = z.object({
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export type TimelineItem =
  | {
      kind: 'activity'
      id: string
      at: string
      type: ActivityType
      body: string | null
      meta: unknown
      actor: { id: string; name: string } | null
    }
  | {
      kind: 'message'
      id: string
      at: string
      channel: 'LINE' | 'MANUAL'
      direction: 'INBOUND' | 'OUTBOUND'
      status: MessageStatus
      body: string
      attemptCount: number
      lastError: string | null
      aiSuggestionId: string | null
    }

export type TimelinePage = { items: TimelineItem[]; nextCursor: string | null }
