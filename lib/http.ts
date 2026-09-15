import 'server-only'
import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { z, ZodError } from 'zod'
import { DomainError, type ErrorCodeValue } from '@/lib/errors'
import { getEnv } from '@/lib/env'
import { log } from '@/lib/log'
import type { ApiErrorBody } from '@/lib/contracts/common'

// [F] lib/http.ts: see docs/design.md section 4 and section 6.
//
// withRoute(name, handler, { public? }):
//  - requestId: from `x-request-id` if it matches REQUEST_ID_RE, else
//    randomUUID(); echoed back on the response header either way.
//  - timing + one `http.request` JSON log line per request (section 7).
//  - Origin check against APP_URL on every non-GET method, unless `public`.
//    This is the CSRF defense that pairs with the session cookie's
//    `sameSite: lax` (section 6). Only the LINE webhook route should set
//    `public: true`: it carries no session cookie and verifies the LINE
//    signature instead. Login must NOT be public, otherwise a login POST is
//    exactly the login CSRF case this check exists to block. Also requires a
//    JSON content type on non-GET requests that actually carry a body.
//  - DomainError and Zod validation errors are mapped onto ApiErrorBody.
//    For status >= 500 the error name and stack are logged server side only,
//    never returned in the response body.

export type RouteHandler<Ctx = unknown> = (req: NextRequest, ctx: Ctx) => Promise<Response>

export interface WithRouteOptions {
  /**
   * Skip the session-origin CSRF check. Only the LINE webhook route should
   * set this: it has no session cookie and verifies the LINE signature
   * instead. Login must NOT be public: without the Origin check a login POST
   * is exactly the login CSRF case the check exists to block.
   */
  public?: boolean
}

const ERROR_STATUS: Record<ErrorCodeValue, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 503,
  INTERNAL: 500,
}

const REQUEST_ID_RE = /^[\w-]{1,128}$/

function resolveRequestId(req: NextRequest): string {
  const incoming = req.headers.get('x-request-id')
  return incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID()
}

const BODYLESS_METHODS = new Set(['GET', 'HEAD', 'DELETE'])

/** True unless content-length is 0, or absent on a method that typically has no body. */
function requestHasBody(req: NextRequest): boolean {
  const contentLength = req.headers.get('content-length')
  if (contentLength === '0') return false
  if (contentLength === null && BODYLESS_METHODS.has(req.method)) return false
  return true
}

function zodToApiErrorBody(error: ZodError, requestId: string): ApiErrorBody {
  const { fieldErrors } = z.flattenError(error)
  const first = error.issues[0]
  return {
    error: {
      code: 'VALIDATION_FAILED',
      message: first?.message ?? 'Validation failed',
      requestId,
      fieldErrors: fieldErrors as Record<string, string[]>,
    },
  }
}

function domainToApiErrorBody(error: DomainError, requestId: string): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    },
  }
}

function unknownToApiErrorBody(requestId: string): ApiErrorBody {
  return {
    error: { code: 'INTERNAL', message: 'Internal server error', requestId },
  }
}

function toApiErrorBody(error: unknown, requestId: string): ApiErrorBody {
  if (error instanceof DomainError) return domainToApiErrorBody(error, requestId)
  if (error instanceof ZodError) return zodToApiErrorBody(error, requestId)
  return unknownToApiErrorBody(requestId)
}

function checkOrigin(req: NextRequest): void {
  const env = getEnv()
  const expectedOrigin = new URL(env.APP_URL).origin
  const origin = req.headers.get('origin')
  if (origin !== expectedOrigin) {
    throw new DomainError('FORBIDDEN', 'origin mismatch')
  }
  if (requestHasBody(req)) {
    const contentType = req.headers.get('content-type') ?? ''
    const essence = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
    if (essence !== 'application/json') {
      throw new DomainError('VALIDATION_FAILED', 'content-type must be application/json')
    }
  }
}

export function withRoute<Ctx = unknown>(
  name: string,
  handler: RouteHandler<Ctx>,
  options: WithRouteOptions = {},
): RouteHandler<Ctx> {
  return async (req, ctx) => {
    const start = Date.now()
    const requestId = resolveRequestId(req)

    try {
      if (!options.public && req.method !== 'GET' && req.method !== 'HEAD') {
        checkOrigin(req)
      }

      const res = await handler(req, ctx)
      res.headers.set('x-request-id', requestId)

      log('info', 'http.request', {
        requestId,
        route: name,
        httpStatus: res.status,
        durationMs: Date.now() - start,
        err: null,
      })

      return res
    } catch (err) {
      // Next's redirect()/notFound() signal via a thrown error that must
      // keep propagating past this catch, not be turned into a JSON 500.
      unstable_rethrow(err)

      const body = toApiErrorBody(err, requestId)
      const status = ERROR_STATUS[body.error.code]

      log(status >= 500 ? 'error' : 'warn', 'http.request', {
        requestId,
        route: name,
        httpStatus: status,
        durationMs: Date.now() - start,
        err: err instanceof Error ? err.message : String(err),
        ...(status >= 500 && err instanceof Error ? { errName: err.name, errStack: err.stack } : {}),
      })

      return NextResponse.json(body, { status, headers: { 'x-request-id': requestId } })
    }
  }
}

/**
 * Reads and validates a JSON request body against `schema`. A SyntaxError
 * (malformed or empty body) becomes DomainError('VALIDATION_FAILED', ...). A
 * schema failure also becomes VALIDATION_FAILED, with per-field errors from
 * z.flattenError; any root-level issues (path.length === 0) are kept under
 * the `_root` key of the same fieldErrors map.
 */
export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let json: unknown
  try {
    json = await req.json()
  } catch (err) {
    throw new DomainError('VALIDATION_FAILED', 'invalid JSON body', undefined, { cause: err })
  }

  const result = schema.safeParse(json)
  if (!result.success) {
    const { fieldErrors, formErrors } = z.flattenError(result.error)
    const errors: Record<string, string[]> = { ...(fieldErrors as Record<string, string[]>) }
    if (formErrors.length > 0) {
      errors._root = formErrors
    }
    throw new DomainError('VALIDATION_FAILED', 'validation failed', errors)
  }

  return result.data
}
