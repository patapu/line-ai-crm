import 'server-only'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import { getEnv } from '@/lib/env'

// [F] lib/auth/session.ts: see docs/design.md section 6.
//
// Stateless JWT session with jose (HS256). `server-only` guards against this
// ever being pulled into a client bundle. Payload is intentionally minimal
// (sub/role/name) per the Next.js auth guide's tip: no PII, no password data.

export type SessionRole = 'ADMIN' | 'SALES'

export interface SessionPayload {
  sub: string
  role: SessionRole
  name: string
}

export const SESSION_COOKIE_NAME = 'crm_session'
const MAX_AGE_SECONDS = 8 * 60 * 60 // 8 hours

function encodedKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().SESSION_SECRET)
}

export async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT({ sub: payload.sub, role: payload.role, name: payload.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(encodedKey())
}

/** Never throws. Returns null on a missing, malformed, expired or tampered token. */
export async function decrypt(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, encodedKey(), {
      algorithms: ['HS256'],
      requiredClaims: ['exp'],
    })
    const { sub, role, name } = payload
    if (typeof sub !== 'string' || typeof name !== 'string') return null
    if (role !== 'ADMIN' && role !== 'SALES') return null
    return { sub, role, name }
  } catch {
    return null
  }
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: MAX_AGE_SECONDS,
}

/** Sets the crm_session cookie. Must run inside a Server Function or Route Handler. */
export async function createSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await encrypt(payload)
  const store = await cookies()
  store.set(SESSION_COOKIE_NAME, token, COOKIE_OPTIONS)
}

/**
 * Sets the crm_session cookie on a NextResponse, using the same cookie
 * options as createSessionCookie. For Route Handlers that build their own
 * response (for example the login route) instead of relying on the
 * `cookies()` API.
 */
export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE_NAME, token, COOKIE_OPTIONS)
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE_NAME)
}
