import { NextResponse } from 'next/server'
import { withRoute } from '@/lib/http'
import { SESSION_COOKIE_NAME } from '@/lib/auth/session'

// [A] app/api/auth/logout/route.ts: see docs/design.md section 3's API table.
//
// No requireUser: logout is idempotent, and the Origin check `withRoute` runs
// on every non-GET method still blocks logout CSRF. The cookie is cleared
// directly on the built response instead of via `clearSessionCookie()`,
// because that helper calls `await cookies()`, which needs a request-scoped
// Next.js context and would break a direct `POST(req)` call in tests.
export const POST = withRoute('POST /api/auth/logout', async () => {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return res
})
