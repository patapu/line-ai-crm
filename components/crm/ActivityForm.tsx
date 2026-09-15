'use client'

// OWNER: lane A
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { ApiError, apiFetch } from '@/components/crm/api'
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABEL } from '@/components/crm/constants'

export interface ActivityFormProps {
  leadId: string
}

export function ActivityForm({ leadId }: ActivityFormProps) {
  const router = useRouter()
  const [type, setType] = useState<(typeof ACTIVITY_TYPES)[number]>('NOTE')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await apiFetch(`/api/leads/${leadId}/activities`, { method: 'POST', body: { type, body } })
      setBody('')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Select
        aria-label="ประเภทกิจกรรม"
        value={type}
        onChange={(event) => setType(event.target.value as (typeof ACTIVITY_TYPES)[number])}
      >
        {ACTIVITY_TYPES.map((t) => (
          <option key={t} value={t}>
            {ACTIVITY_TYPE_LABEL[t]}
          </option>
        ))}
      </Select>
      <Textarea
        aria-label="รายละเอียดกิจกรรม"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="รายละเอียด"
        required
        maxLength={4000}
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Button type="submit" size="sm" disabled={submitting}>
        บันทึกกิจกรรม
      </Button>
    </form>
  )
}
