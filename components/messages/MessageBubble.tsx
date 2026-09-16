'use client'

// [C] components/messages/MessageBubble.tsx: see docs/design.md section 5B
// step 9. Props are NOT frozen (section 1: lane C owns them), only the
// export name and this module's location are, so Lane A's timeline can map
// a TimelineItem 'message' entry straight into { message, canRetry }.
// MessageItem is redefined locally from the frozen lib/contracts/timeline.ts
// contract instead of importing modules/line/dto.ts, which only keeps server
// mapping code (Prisma Message -> MessageItem) out of the client bundle.

import { useMemo, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import type { TimelineItem } from '@/lib/contracts/timeline'
import { readErrorMessage } from '@/components/messages/errors'

type MessageItem = Extract<TimelineItem, { kind: 'message' }>

export interface MessageBubbleProps {
  message: MessageItem
  canRetry: boolean
}

const CHANNEL_BG: Record<MessageItem['channel'], string> = {
  LINE: 'bg-green-100',
  MANUAL: 'bg-slate-100',
}

/** Mirrors modules/line/service.ts's RETRY_KEY_MAX_AGE_MS (23h, design section 10). */
const RETRY_KEY_MAX_AGE_MS = 23 * 60 * 60 * 1000

/** setTimeout stores its delay as a 32-bit signed int; anything above this overflows and fires immediately. */
const MAX_SET_TIMEOUT_DELAY_MS = 2 ** 31 - 1

interface RetryExpiryStore {
  subscribe: (onStoreChange: () => void) => () => void
  getSnapshot: () => boolean
}

/**
 * An external store for "has the 23h retry window closed for this message".
 * getSnapshot only ever returns a cached boolean, so it stays pure to call
 * during render. subscribe runs afterwards, in an effect, where reading the
 * clock is fine: it schedules at most one timer for the moment the window
 * closes (or, if it already has, flips the flag and notifies right away
 * instead of arming a timer).
 */
function createRetryExpiryStore(at: string): RetryExpiryStore {
  const deadline = Date.parse(at) + RETRY_KEY_MAX_AGE_MS
  let expired = false

  return {
    subscribe(onStoreChange) {
      const delay = deadline - Date.now()
      if (delay <= 0) {
        expired = true
        onStoreChange()
        return () => {}
      }
      const timer = setTimeout(() => {
        expired = true
        onStoreChange()
      }, Math.min(delay, MAX_SET_TIMEOUT_DELAY_MS))
      return () => clearTimeout(timer)
    },
    getSnapshot() {
      return expired
    },
  }
}

/** The server (and the first client render, before hydration) always sees "not expired yet". */
function getServerRetryExpirySnapshot(): boolean {
  return false
}

export function MessageBubble({ message, canRetry }: MessageBubbleProps) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const retryExpiryStore = useMemo(() => createRetryExpiryStore(message.at), [message.at])
  const isPastRetryWindow = useSyncExternalStore(
    retryExpiryStore.subscribe,
    retryExpiryStore.getSnapshot,
    getServerRetryExpirySnapshot
  )

  const isOutbound = message.direction === 'OUTBOUND'
  const bg = message.direction === 'INBOUND' ? 'bg-gray-100' : CHANNEL_BG[message.channel]
  const failed = message.status === 'FAILED'
  const showRetry =
    canRetry &&
    message.channel === 'LINE' &&
    message.direction === 'OUTBOUND' &&
    (message.status === 'FAILED' || message.status === 'QUEUED') &&
    !isPastRetryWindow

  async function handleRetry() {
    setPending(true)
    setError(null)
    try {
      let res: Response
      try {
        res = await fetch('/api/messages/' + encodeURIComponent(message.id) + '/retry', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      } catch {
        setError('Network error, try again.')
        return
      }

      const json: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        setError(readErrorMessage(json, res.status))
        return
      }
    } finally {
      setPending(false)
      router.refresh()
    }
  }

  return (
    <div className={'flex ' + (isOutbound ? 'justify-end' : 'justify-start')}>
      <div className={'max-w-[75%] rounded-lg p-3 text-sm ' + bg + (failed ? ' border border-red-400' : '')}>
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>{message.channel}</span>
          <span>{message.direction}</span>
          <time dateTime={message.at} suppressHydrationWarning>
            {new Date(message.at).toLocaleString()}
          </time>
          <span className="rounded bg-white px-1 text-[10px] uppercase text-slate-500">{message.status}</span>
          {message.aiSuggestionId && (
            <span className="rounded bg-indigo-100 px-1 text-[10px] uppercase text-indigo-700">AI draft</span>
          )}
        </div>

        <p className="whitespace-pre-wrap break-words">{message.body}</p>

        {failed && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {message.lastError} (attempt {message.attemptCount})
          </p>
        )}

        {showRetry && (
          <button
            type="button"
            onClick={handleRetry}
            disabled={pending}
            className="mt-2 rounded bg-red-600 px-2 py-1 text-xs text-white disabled:opacity-40"
          >
            {pending ? 'Retrying...' : 'Retry'}
          </button>
        )}

        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
