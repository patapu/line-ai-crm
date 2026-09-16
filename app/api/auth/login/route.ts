import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { withRoute, readJson } from '@/lib/http'
import { DomainError } from '@/lib/errors'
import { log } from '@/lib/log'
import { LoginInput } from '@/lib/contracts/crm'
import { encrypt, setSessionCookie } from '@/lib/auth/session'
import { verifyPassword, verifyPasswordDummy } from '@/lib/auth/password'

// [A] app/api/auth/login/route.ts: see docs/design.md section 3's API table
// and section 6. This route is intentionally NOT `withRoute({ public: true })`:
// without the Origin check a login POST is exactly the login CSRF case that
// check exists to block.
//
// Failure limiter is best-effort and per server instance (design section 6):
// it resets on redeploy, and does not survive multiple instances. That is an
// accepted tradeoff, not a bug.

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 10
// Keyed on email alone, with a higher cap: catches an attacker rotating IPs
// against one account, on top of the tighter ip|email limit below.
//
// Accepted tradeoff: because this counter is keyed on email only, anyone who
// knows (or guesses) a real email address can lock it out for one 15 minute
// window by sending 30 failing attempts from anywhere. The window is bounded
// and fixed (it does not extend on further failures), and a single success
// clears both counters, so this is a denial-of-service on one account for at
// most 15 minutes, never an account takeover or an unbounded lockout. That is
// acceptable for the demo MVP; revisit with a CAPTCHA after N failures or
// per-IP distinct counting (instead of a flat email-wide cap) before this
// goes to production.
const MAX_EMAIL_FAILURES = 30
const MAX_KEYS = 10_000

type FailureEntry = { count: number; resetAt: number }

const failuresByIpEmail = new Map<string, FailureEntry>()
const failuresByEmail = new Map<string, FailureEntry>()

/**
 * Bounds a map's memory: prunes expired entries first; if still at
 * MAX_KEYS, evicts the oldest entries instead of `clear()`-ing the whole
 * map, which would reset every other key's rate limit at once. Map
 * iteration order is insertion order, and `.set` on an existing key does
 * not move it, so the first keys visited are genuinely the oldest.
 */
function makeRoomFor(map: Map<string, FailureEntry>, key: string, now: number): void {
  if (map.size < MAX_KEYS || map.has(key)) return

  for (const [k, v] of map) {
    if (v.resetAt <= now) map.delete(k)
  }
  while (map.size >= MAX_KEYS) {
    const oldestKey = map.keys().next().value
    if (oldestKey === undefined) break
    map.delete(oldestKey)
  }
}

function recordFailure(map: Map<string, FailureEntry>, key: string, now: number): void {
  makeRoomFor(map, key, now)

  const existing = map.get(key)
  if (existing && existing.resetAt > now) {
    existing.count += 1
  } else {
    // Re-arming an expired key: delete first so `.set` below inserts it
    // fresh at the end of iteration order. `.set` on an already-present key
    // does not move it, so without this delete an expired-then-reused key
    // would keep its old (stale) position and `makeRoomFor` could evict a
    // genuinely newer key instead of this one.
    if (existing) map.delete(key)
    map.set(key, { count: 1, resetAt: now + WINDOW_MS })
  }
}

function isLimited(map: Map<string, FailureEntry>, key: string, now: number, max: number): boolean {
  const entry = map.get(key)
  return !!entry && now < entry.resetAt && entry.count >= max
}

export const POST = withRoute('POST /api/auth/login', async (req) => {
  const input = await readJson(req, LoginInput)
  const email = input.email.trim().toLowerCase()
  // x-forwarded-for is only trustworthy behind a trusted proxy (Vercel sets
  // it at the edge); do not rely on it if this app is ever deployed behind
  // an untrusted reverse proxy.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  const key = `${ip}|${email}`
  const now = Date.now()

  // The email-only check below is the accepted lockout tradeoff documented
  // at MAX_EMAIL_FAILURES above: it can be used to lock out a known email
  // for one bounded 15 minute window, which is acceptable for the demo MVP.
  if (
    isLimited(failuresByIpEmail, key, now, MAX_FAILURES) ||
    isLimited(failuresByEmail, email, now, MAX_EMAIL_FAILURES)
  ) {
    throw new DomainError('RATE_LIMITED', 'too many login attempts, try again later')
  }

  const user = await getDb().user.findUnique({
    where: { email },
    select: { id: true, name: true, role: true, passwordHash: true, active: true },
  })
  const ok = user
    ? await verifyPassword(input.password, user.passwordHash)
    : await verifyPasswordDummy(input.password)

  // The inactive check comes after password verification, so timing and the
  // message are identical whether the email is unknown, the password is
  // wrong, or the account is disabled.
  if (!user || !ok || !user.active) {
    recordFailure(failuresByIpEmail, key, now)
    recordFailure(failuresByEmail, email, now)
    // Never log the email: userId only if the account exists, nothing
    // identifying otherwise.
    log('warn', 'auth.login_failed', user ? { userId: user.id } : {})
    throw new DomainError('UNAUTHENTICATED', 'invalid email or password')
  }

  failuresByIpEmail.delete(key)
  failuresByEmail.delete(email)

  log('info', 'auth.login_ok', { userId: user.id })

  const res = NextResponse.json({ user: { id: user.id, name: user.name, role: user.role } })
  setSessionCookie(res, await encrypt({ sub: user.id, role: user.role, name: user.name }))
  return res
})
