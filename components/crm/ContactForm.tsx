'use client'

// OWNER: lane A
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { ApiError, apiFetch } from '@/components/crm/api'
import type { CompanyOption, ContactDetail, UserOption } from '@/modules/crm/repository'

export interface ContactFormProps {
  mode: 'create' | 'edit'
  contact?: ContactDetail
  companies: CompanyOption[]
  users: UserOption[]
}

export function ContactForm({ mode, contact, companies, users }: ContactFormProps) {
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
      firstName: String(form.get('firstName') ?? ''),
      lastName: String(form.get('lastName') ?? '').trim() || null,
      email: String(form.get('email') ?? '').trim() || null,
      phone: String(form.get('phone') ?? '').trim() || null,
      companyId: String(form.get('companyId') ?? '').trim() || null,
      ownerId: String(form.get('ownerId') ?? '').trim() || null,
    }

    try {
      if (mode === 'create') {
        const created = await apiFetch<{ id: string }>('/api/contacts', { method: 'POST', body })
        router.push(`/contacts/${created.id}`)
      } else if (contact) {
        await apiFetch(`/api/contacts/${contact.id}`, { method: 'PATCH', body })
        router.refresh()
      }
    } catch (err) {
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
      <Field label="ชื่อ" htmlFor="firstName" error={fieldErrors.firstName?.[0]}>
        <Input id="firstName" name="firstName" defaultValue={contact?.firstName} required maxLength={100} />
      </Field>
      <Field label="นามสกุล" htmlFor="lastName" error={fieldErrors.lastName?.[0]}>
        <Input id="lastName" name="lastName" defaultValue={contact?.lastName ?? ''} maxLength={100} />
      </Field>
      <Field label="อีเมล" htmlFor="email" error={fieldErrors.email?.[0]}>
        <Input id="email" name="email" type="email" defaultValue={contact?.email ?? ''} />
      </Field>
      <Field label="เบอร์โทร" htmlFor="phone" error={fieldErrors.phone?.[0]}>
        <Input id="phone" name="phone" defaultValue={contact?.phone ?? ''} />
      </Field>
      <Field label="บริษัท" htmlFor="companyId" error={fieldErrors.companyId?.[0]}>
        <Select id="companyId" name="companyId" defaultValue={contact?.companyId ?? ''}>
          <option value="">ไม่ระบุ</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="เจ้าของ" htmlFor="ownerId" error={fieldErrors.ownerId?.[0]}>
        <Select id="ownerId" name="ownerId" defaultValue={contact?.ownerId ?? ''}>
          <option value="">ไม่ระบุ</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </Select>
      </Field>
      {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
      <Button type="submit" disabled={submitting}>
        {mode === 'create' ? 'สร้าง Contact' : 'บันทึก'}
      </Button>
    </form>
  )
}
