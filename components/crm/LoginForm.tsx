'use client'

// OWNER: lane A
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { ApiError, apiFetch } from '@/components/crm/api'
import { safeNext } from '@/components/crm/safe-next'

export interface LoginFormProps {
  next: string
}

export function LoginForm({ next }: LoginFormProps) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await apiFetch('/api/auth/login', { method: 'POST', body: { email, password } })
      // Defensive re-check: `next` was already sanitized server-side by the
      // login page, but never hard-navigate on an unsanitized value here.
      router.replace(safeNext(next))
      router.refresh()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Email or password is incorrect')
      } else if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts, try again later')
      } else {
        setError('Login failed, please try again')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          autoComplete="current-password"
        />
      </Field>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
      </Button>
    </form>
  )
}
