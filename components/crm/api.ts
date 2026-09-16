// OWNER: lane A
//
// Plain module, imported only by 'use client' components in components/crm/*.
// Client mutations go through the Lane A Route Handlers (same-origin fetch,
// so the browser sends Origin and withRoute's CSRF check passes), then the
// caller runs router.refresh()/router.push(...).

import type { ApiErrorBody } from '@/lib/contracts/common'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ApiFetchInit {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
}

/**
 * `apiFetch` throws `ApiError` on every non-ok response (any status outside
 * 200-299, including 401): it never redirects itself, since a shared fetch
 * helper cannot know the caller's current path to build a useful `next`.
 * Callers that can reach an expired session (forms, pickers, timelines)
 * catch the error and pass it to `redirectOnUnauthorized` from
 * `@/components/crm/auth-redirect`, which redirects to
 * `/login?next=...` on a 401 and otherwise leaves the error for the
 * caller's own display logic.
 */
export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const method = init.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'DELETE'

  const res = await fetch(path, {
    method,
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(init.body ?? {}) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
  })

  if (res.status === 204) return undefined as T

  if (!res.ok) {
    let body: ApiErrorBody | null = null
    try {
      body = (await res.json()) as ApiErrorBody
    } catch {
      body = null
    }
    throw new ApiError(
      res.status,
      body?.error.code ?? 'INTERNAL',
      body?.error.message ?? 'request failed',
      body?.error.fieldErrors,
    )
  }

  return (await res.json()) as T
}
