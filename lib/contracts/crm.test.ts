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
  const acceptedValues = [
    0,
    0.01,
    0.07,
    19.99,
    1234.56,
    9_999_999_999.99,
    null,
    undefined,
    5_000_000_000.05,
    1_234_567_890.12,
    9_999_999_999.98,
    0.29,
    0.57,
    1.15,
    2.03,
    4.35,
    100.01,
  ]

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

  // Non-cent values below the cap: fail the multipleOf(0.01) check, not the max check.
  // Zod 4's $ZodCheckMultipleOf pushes code "not_multiple_of"
  // (node_modules/zod/v4/core/checks.js:76).
  const nonCentBelowCapValues = [5_000_000_000.005, 1_234_567_890.123, 9_999_999_999.985]

  it.each(nonCentBelowCapValues)('rejects non-cent value %s below the cap', (value) => {
    const result = LeadCreate.safeParse({ ...baseLeadCreate, value })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'value')).toBe(true)
      expect(result.error.issues.some((issue) => issue.code === 'not_multiple_of')).toBe(true)
      expect(result.error.issues.some((issue) => issue.code === 'too_big')).toBe(false)
    }
  })
})

describe('LeadUpdate value cap and cents-only rule', () => {
  const acceptedValues = [
    0,
    0.01,
    0.07,
    19.99,
    1234.56,
    9_999_999_999.99,
    null,
    undefined,
    5_000_000_000.05,
    1_234_567_890.12,
    9_999_999_999.98,
    0.29,
    0.57,
    1.15,
    2.03,
    4.35,
    100.01,
  ]

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

  // Non-cent values below the cap: fail the multipleOf(0.01) check, not the max check.
  // Zod 4's $ZodCheckMultipleOf pushes code "not_multiple_of"
  // (node_modules/zod/v4/core/checks.js:76).
  const nonCentBelowCapValues = [5_000_000_000.005, 1_234_567_890.123, 9_999_999_999.985]

  it.each(nonCentBelowCapValues)('rejects non-cent value %s below the cap', (value) => {
    const result = LeadUpdate.safeParse({ value })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'value')).toBe(true)
      expect(result.error.issues.some((issue) => issue.code === 'not_multiple_of')).toBe(true)
      expect(result.error.issues.some((issue) => issue.code === 'too_big')).toBe(false)
    }
  })
})
