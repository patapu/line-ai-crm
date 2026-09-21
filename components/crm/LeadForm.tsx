'use client'

// OWNER: lane A
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { ContactPicker, type ContactPickerOption } from '@/components/crm/ContactPicker'
import { ApiError, apiFetch } from '@/components/crm/api'
import { redirectOnUnauthorized } from '@/components/crm/auth-redirect'
import { SOURCES, SOURCE_LABEL } from '@/components/crm/constants'
import type { LeadDetail } from '@/modules/crm/types'
import type { CompanyOption, UserOption } from '@/modules/crm/repository'

export interface LeadFormProps {
  mode: 'create' | 'edit'
  lead?: LeadDetail
  users: UserOption[]
  companies: CompanyOption[]
  canReassign: boolean
  initialContact?: ContactPickerOption | null
}

function contactLabel(lead: LeadDetail): string {
  return lead.contact.lastName ? `${lead.contact.firstName} ${lead.contact.lastName}` : lead.contact.firstName
}

export function LeadForm({ mode, lead, users, companies, canReassign, initialContact }: LeadFormProps) {
  const router = useRouter()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const contactInitial: ContactPickerOption | null =
    initialContact ?? (lead ? { id: lead.contact.id, label: contactLabel(lead) } : null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setFieldErrors({})
    setSubmitting(true)

    const form = new FormData(event.currentTarget)
    const contactId = String(form.get('contactId') ?? '')
    const title = String(form.get('title') ?? '')
    const companyIdRaw = String(form.get('companyId') ?? '').trim()
    const valueRaw = String(form.get('value') ?? '').trim()
    const value = valueRaw ? Number(valueRaw) : null
    const ownerIdRaw = String(form.get('ownerId') ?? '').trim() || undefined

    const body: Record<string, unknown> = { title, contactId, value }
    if (mode === 'edit') {
      // Edit mode keeps sending null so a blank company field clears it.
      body.companyId = companyIdRaw || null
    } else if (companyIdRaw) {
      // Create mode omits a blank companyId so the service inherits the
      // contact's own company instead of overriding it with null.
      body.companyId = companyIdRaw
    }
    if (canReassign && ownerIdRaw) body.ownerId = ownerIdRaw
    if (mode === 'create') body.source = String(form.get('source') ?? 'MANUAL')

    try {
      if (mode === 'create') {
        const created = await apiFetch<{ id: string }>('/api/leads', { method: 'POST', body })
        router.push(`/leads/${created.id}`)
      } else if (lead) {
        await apiFetch(`/api/leads/${lead.id}`, { method: 'PATCH', body })
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
      <Field label="ชื่อ Lead" htmlFor="title" error={fieldErrors.title?.[0]}>
        <Input id="title" name="title" defaultValue={lead?.title} required maxLength={200} />
      </Field>
      <Field label="Contact" htmlFor="contactId" error={fieldErrors.contactId?.[0]}>
        <ContactPicker id="contactId" name="contactId" initial={contactInitial} />
      </Field>
      <Field label="บริษัท" htmlFor="companyId" error={fieldErrors.companyId?.[0]}>
        <Select id="companyId" name="companyId" defaultValue={lead?.company?.id ?? ''}>
          <option value="">ไม่ระบุ</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="มูลค่า (บาท)" htmlFor="value" error={fieldErrors.value?.[0]}>
        <Input
          id="value"
          name="value"
          type="number"
          min={0}
          max={9999999999.99}
          step="0.01"
          defaultValue={lead?.value ?? ''}
        />
      </Field>
      {mode === 'create' ? (
        <Field label="ที่มา" htmlFor="source">
          <Select id="source" name="source" defaultValue="MANUAL">
            {SOURCES.map((source) => (
              <option key={source} value={source}>
                {SOURCE_LABEL[source]}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {canReassign ? (
        <Field label="เจ้าของ" htmlFor="ownerId" error={fieldErrors.ownerId?.[0]}>
          <Select id="ownerId" name="ownerId" defaultValue={lead?.ownerId ?? ''}>
            <option value="">{mode === 'create' ? 'ตัวฉันเอง (ค่าเริ่มต้น)' : 'ไม่เปลี่ยน'}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {formError ? <p className="text-sm text-danger">{formError}</p> : null}
      <Button type="submit" disabled={submitting}>
        {mode === 'create' ? 'สร้าง Lead' : 'บันทึก'}
      </Button>
    </form>
  )
}
