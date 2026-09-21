import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MessageBubble } from '@/components/messages/MessageBubble'
import type { TimelineItem } from '@/lib/contracts/timeline'

// [C-tester] components/messages/__tests__/MessageBubble.format.test.tsx
// Covers S2/S3: MessageBubble now renders {formatDateTime(message.at)}
// (components/ui/format.ts) inside its <time> element instead of the old
// new Date(message.at).toLocaleString() with no locale/timezone pinned.
// formatDateTime always passes timeZone: 'Asia/Bangkok', so the assertions
// below must hold no matter what TZ the test runner process itself is in.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

type MessageItem = Extract<TimelineItem, { kind: 'message' }>

function makeMessage(overrides: Partial<MessageItem> = {}): MessageItem {
  return {
    kind: 'message',
    id: 'msg-1',
    at: '2026-09-21T04:40:39.000Z',
    channel: 'LINE',
    direction: 'OUTBOUND',
    status: 'SENT',
    body: 'hello',
    attemptCount: 0,
    lastError: null,
    aiSuggestionId: null,
    ...overrides,
  }
}

describe('MessageBubble date formatting', () => {
  it('renders message.at in th-TH Asia/Bangkok format (Buddhist-era year, 24h local time, no AM/PM)', () => {
    const html = renderToString(<MessageBubble message={makeMessage()} canRetry={false} />)

    // 2026-09-21T04:40:39.000Z is 2026-09-21 11:40:39 in Asia/Bangkok (UTC+7).
    expect(html).toContain('11:40')
    // th-TH uses the Buddhist Era: 2026 + 543 = 2569.
    expect(html).toContain('2569')
    expect(html).not.toContain('AM')
    expect(html).not.toContain('PM')
  })

  it('places the formatted date inside the <time> element with a matching dateTime attribute', () => {
    const at = '2026-09-21T04:40:39.000Z'
    const html = renderToString(<MessageBubble message={makeMessage({ at })} canRetry={false} />)

    const match = html.match(/<time dateTime="([^"]+)"[^>]*>([\s\S]*?)<\/time>/)
    expect(match).not.toBeNull()
    expect(match?.[1]).toBe(at)
    expect(match?.[2]).toContain('11:40')
  })
})
