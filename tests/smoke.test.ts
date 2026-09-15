import { describe, expect, it, vi } from 'vitest'
import { StageChange } from '@/lib/contracts/crm'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { decrypt, encrypt } from '@/lib/auth/session'
import { log } from '@/lib/log'

// [F] tests/smoke.test.ts: needs NO database. Covers the four checks the
// layer 0 spec requires before any lane's DB-backed tests run (Lane D owns
// those). See docs/design.md section 6 for auth and section 7 for logging.

describe('StageChange contract', () => {
  it('rejects LOST without a reason', () => {
    const result = StageChange.safeParse({ to: 'LOST' })
    expect(result.success).toBe(false)
  })

  it('accepts LOST with a reason', () => {
    const result = StageChange.safeParse({ to: 'LOST', reason: 'budget cut' })
    expect(result.success).toBe(true)
  })

  it('accepts a non-LOST stage without a reason', () => {
    const result = StageChange.safeParse({ to: 'QUALIFIED' })
    expect(result.success).toBe(true)
  })
})

describe('password hashing', () => {
  it('round trips a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('wrong password entirely', hash)).resolves.toBe(false)
  })
})

describe('session encrypt/decrypt', () => {
  // vitest.setup.ts sets a test SESSION_SECRET before any test module imports lib/env.ts.
  it('round trips a payload', async () => {
    const payload = { sub: 'user_1', role: 'ADMIN' as const, name: 'Test Admin' }
    const token = await encrypt(payload)
    const decoded = await decrypt(token)
    expect(decoded).toEqual(payload)
  })

  it('returns null for a tampered token', async () => {
    const payload = { sub: 'user_1', role: 'SALES' as const, name: 'Test Sales' }
    const token = await encrypt(payload)
    // Flip a character in the MIDDLE of the payload segment (between the two
    // dots), not the last char of the token: the last base64url char of a
    // segment only encodes padding bits, so flipping it decodes to the same
    // bytes about 1 in 16 times and the tamper silently no-ops.
    const [header, payloadSegment, signature] = token.split('.')
    const mid = Math.floor(payloadSegment.length / 2)
    const midChar = payloadSegment[mid]
    const tamperedPayload =
      payloadSegment.slice(0, mid) + (midChar === 'a' ? 'b' : 'a') + payloadSegment.slice(mid + 1)
    const tampered = `${header}.${tamperedPayload}.${signature}`
    await expect(decrypt(tampered)).resolves.toBeNull()
  })
})

describe('log redaction', () => {
  it('redacts a field named like a secret', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    log('info', 'test.event', { channelSecret: 'super-secret-value', leadId: 'lead_1' })
    // Read the call before mockRestore(): in Vitest 4 restoring also clears mock.calls.
    const line = spy.mock.calls[0]?.[0] as string
    spy.mockRestore()

    expect(line).not.toContain('super-secret-value')

    const parsed = JSON.parse(line)
    expect(parsed.channelSecret).toBe('[REDACTED]')
    expect(parsed.leadId).toBe('lead_1')
  })
})
