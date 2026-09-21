// [C] components/messages/labels.ts: Thai display labels for the message
// enums exposed on TimelineItem's 'message' variant (lib/contracts/timeline.ts,
// frozen). Derived from MessageItem's own field types instead of importing the
// Prisma-generated enums directly, matching the CHANNEL_BG pattern already
// used in MessageBubble.tsx.

import type { TimelineItem } from '@/lib/contracts/timeline'

type MessageItem = Extract<TimelineItem, { kind: 'message' }>

export const CHANNEL_LABEL: Record<MessageItem['channel'], string> = {
  LINE: 'LINE',
  MANUAL: 'บันทึกเอง',
}

export const DIRECTION_LABEL: Record<MessageItem['direction'], string> = {
  OUTBOUND: 'ส่งถึงลูกค้า',
  INBOUND: 'ลูกค้าส่งมา',
}

export const STATUS_LABEL: Record<MessageItem['status'], string> = {
  RECEIVED: 'ได้รับแล้ว',
  QUEUED: 'รอส่ง',
  SENT: 'ส่งแล้ว',
  FAILED: 'ส่งไม่สำเร็จ',
  LOGGED: 'บันทึกแล้ว',
}
