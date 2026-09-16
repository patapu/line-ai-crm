import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  // Without this, each test's `vi.spyOn(console, ...)` above wraps whatever
  // the previous test left behind instead of the real console method.
  // (The `mockReset()` calls in `beforeEach` above are what clear any
  // stale `.mockResolvedValueOnce` queue on the module-mocked getDb,
  // verifyPassword, and verifyPasswordDummy; `vi.restoreAllMocks()` only
  // restores `vi.spyOn` spies, so it does not touch those queues.)
  // `failuresByIpEmail`/`failuresByEmail` themselves are plain
  // module-level Maps with no test hook to reset, so every test in this
  // file (old and new) is written to use its own email address that no
  // other test touches, rather than relying on module isolation.
  afterEach(() => {
    vi.restoreAllMocks()
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

  // MAX_EMAIL_FAILURES in app/api/auth/login/route.ts is 30 at the time of
  // writing (read from source, not assumed): each failure below comes from
  // a distinct x-forwarded-for, so the per-`ip|email` cap (MAX_FAILURES=10)
  // never fires and only the email-only limiter can explain the 429.
  const MAX_EMAIL_FAILURES = 30

  it('locks out one email after MAX_EMAIL_FAILURES failures from distinct IPs, even though no single IP repeats', async () => {
    const email = 'emaillimiter1@test.local'
    mockedGetDb.mockReturnValue(makeFakeDb(vi.fn().mockResolvedValue(null)))

    for (let i = 0; i < MAX_EMAIL_FAILURES; i++) {
      const res = await POST(loginRequest(email, 'wrong-password', `198.51.100.${i + 1}`), {})
      expect(res.status).toBe(401)
    }

    // A brand new IP, never used above: only the email-only counter can
    // explain a 429 here, since this ip|email pair has never failed before.
    const res = await POST(loginRequest(email, 'wrong-password', '198.51.100.31'), {})
    expect(res.status).toBe(429)
  })

  it('a success resets the email-only counter too (further failures start from zero again)', async () => {
    const email = 'emaillimiter2@test.local'
    const user = { id: 'cuser0000003', name: 'Sales Three', role: 'SALES', passwordHash: 'irrelevant', active: true }
    mockedGetDb.mockReturnValue(makeFakeDb(vi.fn().mockResolvedValue(user)))

    // One short of the email-only cap, each from a distinct IP.
    for (let i = 0; i < MAX_EMAIL_FAILURES - 1; i++) {
      mockedVerifyPassword.mockResolvedValueOnce(false)
      const res = await POST(loginRequest(email, 'wrong-password', `203.0.113.${i + 50}`), {})
      expect(res.status).toBe(401)
    }

    mockedVerifyPassword.mockResolvedValueOnce(true)
    const okRes = await POST(loginRequest(email, 'correct-password', '203.0.113.200'), {})
    expect(okRes.status).toBe(200)

    // If the success had NOT cleared failuresByEmail, the counter would
    // already sit at MAX_EMAIL_FAILURES - 1 and the 2nd of these (the
    // MAX_EMAIL_FAILURES-th failure overall) would already be 429. All 5
    // must be 401.
    for (let i = 0; i < 5; i++) {
      mockedVerifyPassword.mockResolvedValueOnce(false)
      const res = await POST(loginRequest(email, 'wrong-password', `198.51.100.${i + 40}`), {})
      expect(res.status).toBe(401)
    }
  })
})

describe('POST /api/auth/login - auth.login_failed log fields', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockedVerifyPassword.mockReset().mockResolvedValue(false)
    mockedVerifyPasswordDummy.mockReset().mockResolvedValue(false)
    mockedGetDb.mockReset()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function loggedEvents(event: string): Record<string, unknown>[] {
    return [...logSpy.mock.calls, ...errorSpy.mock.calls]
      .map((call) => JSON.parse(call[0] as string) as Record<string, unknown>)
      .filter((line) => line.event === event)
  }

  it('logs auth.login_failed with no userId for an unknown email', async () => {
    const email = 'logcheck-unknown@test.local'
    mockedGetDb.mockReturnValue(makeFakeDb(vi.fn().mockResolvedValue(null)))

    const res = await POST(loginRequest(email, 'wrong-password', '192.0.2.10'), {})
    expect(res.status).toBe(401)

    const events = loggedEvents('auth.login_failed')
    expect(events).toHaveLength(1)
    expect(events[0]).not.toHaveProperty('userId')
  })

  it('logs auth.login_failed with the userId for a known email whose password is wrong', async () => {
    const email = 'logcheck-known@test.local'
    const user = { id: 'cuser0000004', name: 'Sales Four', role: 'SALES', passwordHash: 'irrelevant', active: true }
    mockedGetDb.mockReturnValue(makeFakeDb(vi.fn().mockResolvedValue(user)))
    mockedVerifyPassword.mockResolvedValueOnce(false)

    const res = await POST(loginRequest(email, 'wrong-password', '192.0.2.11'), {})
    expect(res.status).toBe(401)

    const events = loggedEvents('auth.login_failed')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ userId: user.id })
  })
})
