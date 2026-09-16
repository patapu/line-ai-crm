'use client'

// OWNER: lane A
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { ApiError, apiFetch } from '@/components/crm/api'
import { redirectOnUnauthorized } from '@/components/crm/auth-redirect'
import type { CompanyDetail } from '@/modules/crm/repository'

export interface CompanyFormProps {
  mode: 'create' | 'edit'
  company?: CompanyDetail
}

export function CompanyForm({ mode, company }: CompanyFormProps) {
  const router = useRouter()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setFieldErrors({})
    setSubmitting(true)

    const form = new FormData(event.currentTarget)
    const body: Record<string, unknown> = {
      name: String(form.get('name') ?? ''),
      domain: String(form.get('domain') ?? '').trim() || null,
      industry: String(form.get('industry') ?? '').trim() || null,
      sizeBand: String(form.get('sizeBand') ?? '').trim() || null,
    }

    try {
      if (mode === 'create') {
        const created = await apiFetch<{ id: string }>('/api/companies', { method: 'POST', body })
        router.push(`/companies/${created.id}`)
      } else if (company) {
        await apiFetch(`/api/companies/${company.id}`, { method: 'PATCH', body })
        router.refresh()
      }
    } catch (err) {
      if (redirectOnUnauthorized(router, err)) return
      if (err instanceof ApiError) {
        setFormError(err.message)
        setFieldErrors(err.fieldErrors ?? {})
      } else {
        setFormError('บันทึกไม่สำเร็จ')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field label="ชื่อบริษัท" htmlFor="name" error={fieldErrors.name?.[0]}>
        <Input id="name" name="name" defaultValue={company?.name} required maxLength={200} />
      </Field>
      <Field label="Domain" htmlFor="domain" error={fieldErrors.domain?.[0]}>
        <Input id="domain" name="domain" defaultValue={company?.domain ?? ''} placeholder="example.com" />
      </Field>
      <Field label="อุตสาหกรรม" htmlFor="industry" error={fieldErrors.industry?.[0]}>
        <Input id="industry" name="industry" defaultValue={company?.industry ?? ''} maxLength={100} />
      </Field>
      <Field label="ขนาดองค์กร" htmlFor="sizeBand" error={fieldErrors.sizeBand?.[0]}>
        <Input id="sizeBand" name="sizeBand" defaultValue={company?.sizeBand ?? ''} maxLength={50} />
      </Field>
      {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
      <Button type="submit" disabled={submitting}>
        {mode === 'create' ? 'สร้างบริษัท' : 'บันทึก'}
      </Button>
    </form>
  )
}
