import 'client-only'

// OWNER: lane A
//
// Shared client-side helper for the "session expired mid-mutation" case:
// every form, picker, and timeline in this folder catches `ApiError` and,
// on a 401, needs to send the user back to `/login` with a `next` that
// returns them to where they were. This used to be copy-pasted in each
// catch block; it now lives here once.

import type { useRouter } from 'next/navigation'
import { ApiError } from '@/components/crm/api'

type Router = ReturnType<typeof useRouter>

/**
 * If `err` is an `ApiError` with `status === 401`, replaces the current
 * route with `/login?next=<current pathname + search>` via `router.replace`
 * (never `window.location.assign`, so this does not trip
 * `@next/next/no-location-assign-relative-destination`) and returns `true`.
 * For any other error, or when already on `/login` (which would otherwise
 * loop), this does nothing and returns `false`.
 *
 * Reads `window.location.pathname`/`search` at call time, from inside the
 * caller's catch block, instead of `usePathname`/`useSearchParams`: this
 * keeps the helper a plain function callers can use straight from an event
 * handler, with no Suspense boundary required.
 */
export function redirectOnUnauthorized(router: Router, err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 401) return false
  if (window.location.pathname === '/login') return false
  const current = `${window.location.pathname}${window.location.search}`
  router.replace(`/login?next=${encodeURIComponent(current)}`)
  return true
}
