import { z } from 'zod'

// [F] lib/contracts/line.ts: see docs/design.md section 3.

export const MessageSend = z.object({
  channel: z.enum(['LINE', 'MANUAL']),
  direction: z.enum(['OUTBOUND', 'INBOUND']).default('OUTBOUND'), // LINE allows OUTBOUND only
  text: z.string().trim().min(1).max(1000),
})

export const LineEvent = z.looseObject({
  type: z.string(),
  webhookEventId: z.string().min(1),
  timestamp: z.number(),
  mode: z.string().optional(),
  deliveryContext: z.object({ isRedelivery: z.boolean() }).optional(),
  source: z.looseObject({ type: z.string(), userId: z.string().optional() }).optional(),
  message: z.looseObject({ id: z.string(), type: z.string(), text: z.string().optional() }).optional(),
})

export const LineWebhookBody = z.object({
  destination: z.string(),
  events: z.array(LineEvent),
})
