import { NextResponse, type NextRequest } from 'next/server'
import { decrypt, SESSION_COOKIE_NAME } from '@/lib/auth/session'

// [A] proxy.ts: see docs/design.md section 6 and lane-A.md task 7.
//
// Optimistic only: this just checks that a syntactically valid, unexpired
// JWT is present in the cookie. It never re-checks `active` in the DB (that
// happens in verifySession / requireUser, which every page and route handler
// calls). `/login` is always let through, cookie or not: redirecting a
// cookie holder away from /login would bounce a deactivated user with a
// still-valid JWT forever between proxy and verifySession's own redirect.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (pathname === '/login') return NextResponse.next()
  if (await decrypt(request.cookies.get(SESSION_COOKIE_NAME)?.value)) return NextResponse.next()

  const url = new URL('/login', request.url)
  if (pathname !== '/') url.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: [
    '/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
