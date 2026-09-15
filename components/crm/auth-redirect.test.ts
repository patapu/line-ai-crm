import { afterEach, describe, expect, it, vi } from 'vitest'
import type { useRouter } from 'next/navigation'
import { ApiError } from '@/components/crm/api'
import { redirectOnUnauthorized } from '@/components/crm/auth-redirect'

type Router = ReturnType<typeof useRouter>

// [A] components/crm/auth-redirect.test.ts: pure-ish unit tests for the
// shared 401 -> /login?next=... redirect helper. vitest.config.ts runs
// under `environment: 'node'` (no jsdom), so there is no real `window`;
// this stubs `globalThis.window` with just the `location` shape the helper
// actually reads (`pathname`, `search`), restored in afterEach so it never
// leaks into other test files that happen to run in the same worker.
// `ApiError` is a plain class with no server-only import, so it is safely
// importable here.

type FakeRouter = { replace: ReturnType<typeof vi.fn> }

function stubLocation(pathname: string, search = ''): void {
  Object.defineProperty(globalThis, 'window', {
    value: { location: { pathname, search } },
    configurable: true,
    writable: true,
  })
}

function fakeRouter(): FakeRouter & Router {
  // Only `replace` is ever called by redirectOnUnauthorized; the other
  // AppRouterInstance methods are cast rather than stubbed since nothing
  // under test invokes them.
  return { replace: vi.fn() } as unknown as FakeRouter & Router
}

describe('redirectOnUnauthorized', () => {
  afterEach(() => {
    // @ts-expect-error -- deleting the test-only stub, not a real global
    delete globalThis.window
  })

  it('replaces with /login?next=<encoded pathname+search> and returns true on a 401 off /login', () => {
    stubLocation('/leads', '?q=x')
    const router = fakeRouter()

    const result = redirectOnUnauthorized(router, new ApiError(401, 'UNAUTHENTICATED', 'session expired'))

    expect(result).toBe(true)
    expect(router.replace).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledWith('/login?next=%2Fleads%3Fq%3Dx')
  })

  it('does nothing and returns false on a 401 while already on /login (would otherwise loop)', () => {
    stubLocation('/login', '?next=%2Fleads')
    const router = fakeRouter()

    const result = redirectOnUnauthorized(router, new ApiError(401, 'UNAUTHENTICATED', 'session expired'))

    expect(result).toBe(false)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('does nothing and returns false for a 403 ApiError', () => {
    stubLocation('/leads', '?q=x')
    const router = fakeRouter()

    const result = redirectOnUnauthorized(router, new ApiError(403, 'FORBIDDEN', 'not allowed'))

    expect(result).toBe(false)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('does nothing and returns false for a non-ApiError value', () => {
    stubLocation('/leads', '?q=x')
    const router = fakeRouter()

    const result = redirectOnUnauthorized(router, new Error('boom'))

    expect(result).toBe(false)
    expect(router.replace).not.toHaveBeenCalled()
  })
})
