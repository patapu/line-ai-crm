'use client'

// OWNER: lane A
//
// Debounced search-and-pick: the timer lives in a ref and is only ever
// touched from the onChange handler, never from an effect.
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Input } from '@/components/ui/Input'
import { apiFetch } from '@/components/crm/api'
import { redirectOnUnauthorized } from '@/components/crm/auth-redirect'
import type { Paged } from '@/lib/contracts/common'
import type { ContactListItem } from '@/modules/crm/repository'

export interface ContactPickerOption {
  id: string
  label: string
}

export interface ContactPickerProps {
  id?: string
  name: string
  initial: ContactPickerOption | null
  onSelect?: (option: ContactPickerOption) => void
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

function labelFor(item: ContactListItem): string {
  return item.lastName ? `${item.firstName} ${item.lastName}` : item.firstName
}

export function ContactPicker({
  id,
  name,
  initial,
  onSelect,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: ContactPickerProps) {
  const router = useRouter()
  const [query, setQuery] = useState(initial?.label ?? '')
  const [selectedId, setSelectedId] = useState(initial?.id ?? '')
  const [options, setOptions] = useState<ContactPickerOption[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The most recently typed value: lets an in-flight search discard its own
  // response if the user has since typed something else, instead of a
  // slower earlier request clobbering a faster later one.
  const latestQuery = useRef('')

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value
    setQuery(value)
    setSelectedId('')
    setOpen(true)
    latestQuery.current = value
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void (async () => {
        if (value.trim().length === 0) {
          setOptions([])
          return
        }
        try {
          const res = await apiFetch<Paged<ContactListItem>>(
            `/api/contacts?q=${encodeURIComponent(value)}&pageSize=10`,
          )
          if (latestQuery.current !== value) return
          setOptions(res.items.map((item) => ({ id: item.id, label: labelFor(item) })))
        } catch (err) {
          if (latestQuery.current !== value) return
          if (redirectOnUnauthorized(router, err)) return
          setOptions([])
        }
      })()
    }, 300)
  }

  function handlePick(option: ContactPickerOption) {
    setSelectedId(option.id)
    setQuery(option.label)
    setOpen(false)
    onSelect?.(option)
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={selectedId} />
      <Input
        id={id}
        value={query}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        placeholder="ค้นหา contact..."
        autoComplete="off"
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
      />
      {open && options.length > 0 ? (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-field border border-line bg-white shadow-lg">
          {options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => handlePick(option)}
                className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-primary-soft focus-visible:bg-primary-soft"
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
