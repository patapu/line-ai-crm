'use client'

// OWNER: lane A
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { ApiError, apiFetch } from '@/components/crm/api'
import { redirectOnUnauthorized } from '@/components/crm/auth-redirect'
import { STAGES, STAGE_LABEL } from '@/components/crm/constants'
import type { LeadStage } from '@/lib/generated/prisma/client'

export interface StageChangerProps {
  leadId: string
  stage: LeadStage
  canChange: boolean
}

export function StageChanger({ leadId, stage, canChange }: StageChangerProps) {
  const router = useRouter()
  const [to, setTo] = useState<LeadStage>(stage)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)

    const trimmedReason = reason.trim()
    if (to === 'LOST' && !trimmedReason) {
      setMessage('กรุณาระบุเหตุผลที่ปิดการขายไม่สำเร็จ')
      return
    }

    setSubmitting(true)
    try {
      const res = await apiFetch<{ changed: boolean }>(`/api/leads/${leadId}/stage`, {
        method: 'POST',
        body: { to, reason: to === 'LOST' ? trimmedReason : undefined },
      })
      if (!res.changed) {
        setMessage('Already in this stage')
      } else {
        router.refresh()
      }
    } catch (err) {
      if (redirectOnUnauthorized(router, err)) return
      if (err instanceof ApiError && err.status === 409) {
        setMessage('Stage was changed by someone else, reload')
      } else if (err instanceof ApiError && err.status === 403) {
        setMessage('You do not have permission to change this stage')
      } else if (err instanceof ApiError && err.fieldErrors?.reason?.[0]) {
        setMessage(err.fieldErrors.reason[0])
      } else if (err instanceof ApiError) {
        setMessage(err.message)
      } else {
        setMessage('เปลี่ยน stage ไม่สำเร็จ')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Select
        aria-label="Stage"
        value={to}
        onChange={(event) => setTo(event.target.value as LeadStage)}
        disabled={!canChange}
      >
        {STAGES.map((s) => (
          <option key={s} value={s} disabled={s === stage}>
            {STAGE_LABEL[s]}
          </option>
        ))}
      </Select>
      {to === 'LOST' ? (
        <Textarea
          aria-label="เหตุผลที่ปิดการขายไม่สำเร็จ"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="เหตุผลที่ปิดการขายไม่สำเร็จ"
          required
          disabled={!canChange}
        />
      ) : null}
      {message ? <p className="text-sm text-muted">{message}</p> : null}
      <Button type="submit" size="sm" disabled={submitting || !canChange}>
        เปลี่ยน stage
      </Button>
    </form>
  )
}
