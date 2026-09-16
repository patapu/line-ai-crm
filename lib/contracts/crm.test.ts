import { describe, expect, it } from 'vitest'
import { LeadCreate, LeadUpdate } from '@/lib/contracts/crm'

// [F] lib/contracts/crm.test.ts: covers CR-1, the Lead.value cap and cents-only
// rule (Decimal(12,2)). See docs/contract-change-requests.md and
// docs/design.md section 3.

const validContactId = 'c123456789012345' // matches IdSchema (z.cuid())

const baseLeadCreate = {
  title: 'Sample lead',
  contactId: validContactId,
}

describe('LeadCreate value cap and cents-only rule', () => {
  const acceptedValues = [0, 0.01, 0.07, 19.99, 1234.56, 9_999_999_999.99, null, undefined]

  it.each(acceptedValues)('accepts value %s', (value) => {
    const input = value === undefined ? { ...baseLeadCreate } : { ...baseLeadCreate, value }
    const result = LeadCreate.safeParse(input)
    expect(result.success).toBe(true)
  })

  const rejectedValues = [
    0.001,
    1.005,
    9_999_999_999.991,
    9_999_999_999.995,
    1e10,
    -0.01,
    NaN,
    Infinity,
  ]

  it.each(rejectedValues)('rejects value %s', (value) => {
    const result = LeadCreate.safeParse({ ...baseLeadCreate, value })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'value')).toBe(true)
    }
  })
})

describe('LeadUpdate value cap and cents-only rule', () => {
  const acceptedValues = [0, 0.01, 0.07, 19.99, 1234.56, 9_999_999_999.99, null, undefined]

  it.each(acceptedValues)('accepts value %s', (value) => {
    const input = value === undefined ? {} : { value }
    const result = LeadUpdate.safeParse(input)
    expect(result.success).toBe(true)
  })

  const rejectedValues = [
    0.001,
    1.005,
    9_999_999_999.991,
    9_999_999_999.995,
    1e10,
    -0.01,
    NaN,
    Infinity,
  ]

  it.each(rejectedValues)('rejects value %s', (value) => {
    const result = LeadUpdate.safeParse({ value })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'value')).toBe(true)
    }
  })
})
