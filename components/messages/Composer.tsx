'use client'

// [C] components/messages/Composer.tsx: see docs/design.md section 5B step
// 10 and section 1's frozen prop shape:
// `components/messages/Composer.tsx, MessageBubble.tsx [C] props [F]:
// { leadId: string; canSend: boolean; hasLine: boolean }`

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { readErrorMessage } from '@/components/messages/errors'
import { Button } from '@/components/ui/Button'

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

  const textFieldId = `composer-text-${leadId}`

  if (!canSend) {
    return (
      <div className="space-y-2">
        <textarea
          disabled
          maxLength={1000}
          aria-label="ข้อความ"
          className="w-full rounded border border-field-border bg-slate-50 p-2 text-sm text-slate-400"
          placeholder="คุณไม่มีสิทธิ์ส่งข้อความใน lead นี้"
        />
        <p className="text-xs text-muted">เฉพาะผู้ดูแล lead นี้หรือแอดมินเท่านั้นที่ส่งข้อความได้</p>
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
          text: 'เครือข่ายขัดข้อง ข้อความอาจส่งไปแล้วหรือยังไม่ได้ส่ง ตรวจดูใน Timeline ก่อนส่งซ้ำ',
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
          text: message.lastError
            ? `ส่งไม่สำเร็จ (${message.lastError}) กด "ส่งอีกครั้ง" ที่ข้อความนั้นใน Timeline`
            : `ส่งไม่สำเร็จ กด "ส่งอีกครั้ง" ที่ข้อความนั้นใน Timeline`,
        })
        setText('')
        return
      }
      setText('')
      setNotice({ kind: 'ok', text: message?.status === 'LOGGED' ? 'บันทึกข้อความแล้ว' : 'ส่งทาง LINE แล้ว' })
    } finally {
      setPending(false)
      router.refresh()
    }
  }

  return (
    <div className="space-y-2">
      <fieldset className="flex items-center gap-4 text-sm">
        <legend className="text-xs text-muted">ช่องทาง</legend>
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
          บันทึกเอง
        </label>
      </fieldset>
      {!hasLine && (
        <p className="text-xs text-muted">ผู้ติดต่อนี้ยังไม่ได้เชื่อมบัญชี LINE จึงบันทึกข้อความเองได้อย่างเดียว</p>
      )}

      {mode === 'MANUAL' && (
        <fieldset className="flex items-center gap-4 text-sm">
          <legend className="text-xs text-muted">ทิศทาง</legend>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={`composer-direction-${leadId}`}
              checked={direction === 'OUTBOUND'}
              onChange={() => setDirection('OUTBOUND')}
            />
            ส่งถึงลูกค้า
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={`composer-direction-${leadId}`}
              checked={direction === 'INBOUND'}
              onChange={() => setDirection('INBOUND')}
            />
            ลูกค้าส่งมา
          </label>
        </fieldset>
      )}

      <label htmlFor={textFieldId} className="text-xs text-muted">
        ข้อความ
      </label>
      <textarea
        id={textFieldId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={1000}
        rows={3}
        className="w-full rounded border border-field-border p-2 text-sm"
        placeholder="พิมพ์ข้อความถึงลูกค้า"
      />
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{text.length}/1000 ตัวอักษร</span>
        <Button type="button" variant="primary" size="sm" disabled={submitDisabled} onClick={handleSubmit}>
          {mode === 'LINE'
            ? pending
              ? 'กำลังส่ง...'
              : 'ส่งทาง LINE'
            : pending
              ? 'กำลังบันทึก...'
              : 'บันทึกข้อความ'}
        </Button>
      </div>

      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : notice.kind === 'ok' ? 'status' : undefined}
          className={
            notice.kind === 'error'
              ? 'text-xs text-danger'
              : notice.kind === 'warn'
                ? 'text-xs text-warning'
                : 'text-xs text-success'
          }
        >
          {notice.text}
        </p>
      )}
    </div>
  )
}
