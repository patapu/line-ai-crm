// [C] modules/line/dto.ts: maps a Prisma `Message` row onto the frozen
// TimelineItem's 'message' variant (lib/contracts/timeline.ts), for
// app/api/leads/[id]/messages and app/api/messages/[id]/retry to return.
// Never includes `payload`, `retryKey`, `lineRequestId` or `sentById`: those
// are internal delivery details, not part of the timeline contract.

import type { Message } from '@/lib/generated/prisma/client'
import type { TimelineItem } from '@/lib/contracts/timeline'

export type MessageItem = Extract<TimelineItem, { kind: 'message' }>

export function toMessageItem(m: Message): MessageItem {
  return {
    kind: 'message',
    id: m.id,
    at: m.createdAt.toISOString(),
    channel: m.channel,
    direction: m.direction,
    status: m.status,
    body: m.body,
    attemptCount: m.attemptCount,
    lastError: m.lastError,
    aiSuggestionId: m.aiSuggestionId,
  }
}
