'use client'

// OWNER: lane A
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ApiError, apiFetch } from '@/components/crm/api'
import { redirectOnUnauthorized } from '@/components/crm/auth-redirect'

export interface DeleteButtonProps {
  url: string
  redirectTo: string
  confirmText: string
}

export function DeleteButton({ url, redirectTo, confirmText }: DeleteButtonProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleClick() {
    if (!window.confirm(confirmText)) return
    setError(null)
    setSubmitting(true)
    try {
      await apiFetch(url, { method: 'DELETE' })
      router.push(redirectTo)
      router.refresh()
    } catch (err) {
      if (redirectOnUnauthorized(router, err)) return
      if (err instanceof ApiError && err.status === 409) {
        setError(err.message)
      } else {
        setError('ลบไม่สำเร็จ')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="danger" size="sm" onClick={handleClick} disabled={submitting}>
        ลบ
      </Button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  )
}
