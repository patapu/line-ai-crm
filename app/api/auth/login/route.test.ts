import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyPassword, verifyPasswordDummy } from '@/lib/auth/password'
import { POST } from '@/app/api/auth/login/route'

// [A] app/api/auth/login/route.test.ts: unit tests against a mocked Prisma
// client (`vi.mock('@/lib/db')`, same pattern as tests/security.test.ts) and
// a mocked lib/auth/password (so the tests do not pay the real scrypt cost
// and can deterministically choose success/failure per call), added at S15
// round 2. vitest.setup.ts already sets APP_URL to http://localhost:3000 and
// SESSION_SECRET, which withRoute's origin check and lib/auth/session's
// encrypt() need respectively. No DATABASE_URL connection is ever made:
// getDb() itself is mocked, not just its return value's shape.
vi.mock('@/lib/db')
vi.mock('@/lib/auth/password')

const mockedGetDb = vi.mocked(getDb)
const mockedVerifyPassword = vi.mocked(verifyPassword)
const mockedVerifyPasswordDummy = vi.mocked(verifyPasswordDummy)

function makeFakeDb(userFindUnique: ReturnType<typeof vi.fn>) {
  return { user: { findUnique: userFindUnique } } as unknown as ReturnType<typeof getDb>
}

function loginRequest(email: string, password: string, ip = '203.0.113.1'): NextRequest {
  const body = JSON.stringify({ email, password })
  return new NextRequest('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
      'x-forwarded-for': ip,
    },
    body,
  })
}

describe('POST /api/auth/login', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockedVerifyPassword.mockReset().mockResolvedValue(false)
    mockedVerifyPasswordDummy.mockReset().mockResolvedValue(false)
    mockedGetDb.mockReset()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  function loggedLines(): string[] {
    return [...logSpy.mock.calls, ...errorSpy.mock.calls].map((call) => call[0] as string)
  }

  it('10 consecutive failures for the same ip|email then a 429 on the 11th, with no email ever logged', async () => {
    const email = 'lockout1@test.local'
    mockedGetDb.mockReturnValue(makeFakeDb(vi.fn().mockResolvedValue(null)))

    for (let i = 0; i < 10; i++) {
      const res = await POST(loginRequest(email, 'wrong-password'), {})
      expect(res.status).toBe(401)
    }

    const res = await POST(loginRequest(email, 'wrong-password'), {})
    expect(res.status).toBe(429)

    expect(mockedVerifyPasswordDummy).toHaveBeenCalled()
    for (const line of loggedLines()) {
      expect(line).not.toContain('@')
    }
  })

  it('a success resets the failure counters for that key', async () => {
    const email = 'lockout2@test.local'
    const user = { id: 'cuser0000002', name: 'Sales Two', role: 'SALES', passwordHash: 'irrelevant', active: true }
    mockedGetDb.mockReturnValue(makeFakeDb(vi.fn().mockResolvedValue(user)))

    // 5 failures, under the MAX_FAILURES=10 cap.
    for (let i = 0; i < 5; i++) {
      mockedVerifyPassword.mockResolvedValueOnce(false)
      const res = await POST(loginRequest(email, 'wrong-password'), {})
      expect(res.status).toBe(401)
    }

    // One success: must clear both failuresByIpEmail and failuresByEmail for this key.
    mockedVerifyPassword.mockResolvedValueOnce(true)
    const okRes = await POST(loginRequest(email, 'correct-password'), {})
    expect(okRes.status).toBe(200)
    const okBody = (await okRes.json()) as { user: { id: string } }
    expect(okBody.user.id).toBe(user.id)

    // 9 more failures: if the counter had NOT reset, the 6th of these (11th
    // overall, past the cap of 10) would already be 429. All 9 must be 401.
    for (let i = 0; i < 9; i++) {
      mockedVerifyPassword.mockResolvedValueOnce(false)
      const res = await POST(loginRequest(email, 'wrong-password'), {})
      expect(res.status).toBe(401)
    }

    for (const line of loggedLines()) {
      expect(line).not.toContain('@')
    }
  })
})
