import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MessageBubble } from '@/components/messages/MessageBubble'
import type { TimelineItem } from '@/lib/contracts/timeline'

// [C-tester] components/messages/__tests__/MessageBubble.server.test.tsx
// Covers S2 optional item 3: proves the useSyncExternalStore-based 23h
// retry-window check in MessageBubble (S1's change) renders identically on
// the server regardless of the real wall clock, because
// getServerRetryExpirySnapshot always returns false. A message.at 30 hours
// in the past would make the *client* snapshot (real Date.now() check)
// report "expired" and hide the Retry button, so if server rendering ever
// started reading the real clock instead of the frozen server snapshot,
// this test would start failing (the Retry button would disappear from the
// server-rendered HTML).

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

type MessageItem = Extract<TimelineItem, { kind: 'message' }>

function makeMessage(overrides: Partial<MessageItem> = {}): MessageItem {
  return {
    kind: 'message',
    id: 'msg-1',
    at: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(), // 30h ago: well past the 23h window
    channel: 'LINE',
    direction: 'OUTBOUND',
    status: 'FAILED',
    body: 'hello',
    attemptCount: 3,
    lastError: 'boom',
    aiSuggestionId: null,
    ...overrides,
  }
}

describe('MessageBubble server render', () => {
  it('renders the Retry button in server-rendered HTML even when message.at is 30h old (past the 23h window on any real clock)', () => {
    const html = renderToString(<MessageBubble message={makeMessage()} canRetry={true} />)

    expect(html).toContain('ส่งอีกครั้ง')
    expect(html).toContain('<button')
  })

  it('does not render the Retry button when canRetry is false, regardless of age', () => {
    const html = renderToString(<MessageBubble message={makeMessage()} canRetry={false} />)

    expect(html).not.toContain('<button')
  })

  it('does not render the Retry button for a SENT message, regardless of age', () => {
    const html = renderToString(<MessageBubble message={makeMessage({ status: 'SENT' })} canRetry={true} />)

    expect(html).not.toContain('<button')
  })
})
