import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { NextRequest } from 'next/server'
import { decrypt, SESSION_COOKIE_NAME, type SessionPayload } from '@/lib/auth/session'
import { getDb } from '@/lib/db'
import { DomainError } from '@/lib/errors'

// [F] lib/auth/dal.ts: see docs/design.md section 3 (Actor / canActOnLead)
// and section 6.

export type Actor =
  | { kind: 'user'; id: string; role: 'ADMIN' | 'SALES'; name: string }
  | { kind: 'system'; source: 'line-webhook' | 'seed' }

/**
 * For Server Components and layouts. Reads the cookie via `await cookies()`,
 * per the Next.js auth guide, then re-checks `active` and the current role in
 * the DB (selecting only id, role, name, active: passwordHash is never
 * pulled here), cached per request the same way requireUser is per call.
 * Redirects to /login when there is no valid session or the user is
 * inactive: it does NOT return null, callers can assume a valid payload.
 * Wrapped in React `cache` so one render pass only decrypts the cookie and
 * hits the DB once.
 */
export const verifySession = cache(async (): Promise<SessionPayload> => {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE_NAME)?.value
  const payload = await decrypt(token)
  if (!payload) {
    redirect('/login')
  }

  const db = getDb()
  const user = await db.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, name: true, active: true },
  })
  if (!user || !user.active) {
    redirect('/login')
  }

  return { sub: user.id, role: user.role, name: user.name }
})

/**
 * For Server Components and layouts. Thin wrapper over verifySession that
 * returns the Actor shape the rest of the app uses. Wrapped in React `cache`
 * like verifySession, so it costs nothing extra to call from multiple
 * components in the same render pass.
 */
export const getActor = cache(async (): Promise<Extract<Actor, { kind: 'user' }>> => {
  const session = await verifySession()
  return { kind: 'user', id: session.sub, role: session.role, name: session.name }
})

/**
 * For Route Handlers. Reads `req.cookies` directly instead of `await
 * cookies()` so tests can call `POST(req)` on the handler directly without a
 * request-scoped Next.js context (same pattern an earlier project uses for its API
 * route tests: see docs/design.md section 9).
 *
 * Also re-checks `active` in the DB on every call, so disabling a user's
 * account takes effect immediately even though the JWT itself has not
 * expired yet. Selects only id, role, name, active: passwordHash is never
 * pulled here.
 */
export async function requireUser(req: NextRequest): Promise<Extract<Actor, { kind: 'user' }>> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  const payload = await decrypt(token)
  if (!payload) {
    throw new DomainError('UNAUTHENTICATED', 'no valid session')
  }

  const db = getDb()
  const user = await db.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, name: true, active: true },
  })
  if (!user || !user.active) {
    throw new DomainError('UNAUTHENTICATED', 'session user not found or inactive')
  }

  return { kind: 'user', id: user.id, role: user.role, name: user.name }
}

/**
 * Owner-or-admin gate for lead mutations: stage change, draft approval,
 * sending a message, see design section 3's "สิทธิ์การใช้งาน". System actors
 * (LINE webhook, seed) are trusted call sites that never go through this
 * check on the user-facing routes, so they are allowed through.
 */
export function canActOnLead(actor: Actor, lead: { ownerId: string }): boolean {
  if (actor.kind === 'system') return true
  if (actor.role === 'ADMIN') return true
  return actor.id === lead.ownerId
}
