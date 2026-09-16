'use client'

// [C] components/messages/Composer.tsx: see docs/design.md section 5B step
// 10 and section 1's frozen prop shape:
// `components/messages/Composer.tsx, MessageBubble.tsx [C] props [F]:
// { leadId: string; canSend: boolean; hasLine: boolean }`

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { readErrorMessage } from '@/components/messages/errors'

export interface ComposerProps {
  leadId: string
  canSend: boolean
  hasLine: boolean
}

type Mode = 'LINE' | 'MANUAL'
type Direction = 'INBOUND' | 'OUTBOUND'
type Notice = { kind: 'error' | 'warn' | 'ok'; text: string } | null

/** Defensive read of the `{ message: { status, lastError } }` success shape. */
function readMessageResult(json: unknown): { status?: string; lastError?: string | null } | null {
  if (json && typeof json === 'object') {
    const message = (json as { message?: unknown }).message
    if (message && typeof message === 'object') {
      return message as { status?: string; lastError?: string | null }
    }
  }
  return null
}

export function Composer({ leadId, canSend, hasLine }: ComposerProps) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>(hasLine ? 'LINE' : 'MANUAL')
  const [direction, setDirection] = useState<Direction>('OUTBOUND')
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  if (!canSend) {
    return (
      <div className="space-y-2">
        <textarea
          disabled
          maxLength={1000}
          className="w-full rounded border border-slate-200 bg-slate-50 p-2 text-sm text-slate-400"
          placeholder="You cannot send messages on this lead."
        />
        <p className="text-xs text-slate-500">Only the lead owner or an admin can send messages.</p>
      </div>
    )
  }

  const trimmed = text.trim()
  const submitDisabled = pending || trimmed.length === 0 || (mode === 'LINE' && !hasLine)

  async function handleSubmit() {
    setPending(true)
    setNotice(null)
    try {
      const body: { channel: Mode; text: string; direction?: Direction } = { channel: mode, text: trimmed }
      if (mode === 'MANUAL') {
        body.direction = direction
      }

      let res: Response
      try {
        res = await fetch('/api/leads/' + encodeURIComponent(leadId) + '/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      } catch {
        setNotice({
          kind: 'error',
          text: 'Network error: the message may or may not have been sent. Check the conversation before sending again.',
        })
        return
      }

      const json: unknown = await res.json().catch(() => null)

      if (!res.ok) {
        setNotice({ kind: 'error', text: readErrorMessage(json, res.status) })
        return
      }

      const message = readMessageResult(json)
      if (message?.status === 'FAILED') {
        setNotice({
          kind: 'warn',
          text: `Not delivered (${message.lastError}). Use Retry on the message.`,
        })
        setText('')
        return
      }
      setText('')
      setNotice({ kind: 'ok', text: message?.status === 'LOGGED' ? 'Logged.' : 'Sent.' })
    } finally {
      setPending(false)
      router.refresh()
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name={`composer-mode-${leadId}`}
            checked={mode === 'LINE'}
            disabled={!hasLine}
            onChange={() => setMode('LINE')}
          />
          LINE
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name={`composer-mode-${leadId}`}
            checked={mode === 'MANUAL'}
            onChange={() => setMode('MANUAL')}
          />
          Manual
        </label>
      </div>
      {!hasLine && <p className="text-xs text-slate-500">This contact has no LINE account linked.</p>}

      {mode === 'MANUAL' && (
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={`composer-direction-${leadId}`}
              checked={direction === 'OUTBOUND'}
              onChange={() => setDirection('OUTBOUND')}
            />
            Outbound
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={`composer-direction-${leadId}`}
              checked={direction === 'INBOUND'}
              onChange={() => setDirection('INBOUND')}
            />
            Inbound
          </label>
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={1000}
        rows={3}
        className="w-full rounded border border-slate-300 p-2 text-sm"
        placeholder="Type a message..."
      />
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{text.length}/1000</span>
        <button
          type="button"
          disabled={submitDisabled}
          onClick={handleSubmit}
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-40"
        >
          {pending ? 'Sending...' : 'Send'}
        </button>
      </div>

      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : undefined}
          className={
            notice.kind === 'error'
              ? 'text-xs text-red-600'
              : notice.kind === 'warn'
                ? 'text-xs text-amber-600'
                : 'text-xs text-green-600'
          }
        >
          {notice.text}
        </p>
      )}
    </div>
  )
}
