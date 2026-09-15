import type { z } from 'zod'
import { ErrorCode } from '@/lib/contracts/common'

// [F] lib/errors.ts: see docs/design.md section 4 ("lib/errors.ts [F]:
// class DomainError(code: ErrorCode, message, fieldErrors?) ; services throw
// it"). `lib/http.ts` is the single place that catches this and maps it onto
// the ApiErrorBody shape.

export type ErrorCodeValue = z.infer<typeof ErrorCode>

export class DomainError extends Error {
  readonly code: ErrorCodeValue
  readonly fieldErrors?: Record<string, string[]>

  constructor(
    code: ErrorCodeValue,
    message: string,
    fieldErrors?: Record<string, string[]>,
    options?: { cause?: unknown },
  ) {
    super(message, { cause: options?.cause })
    this.name = 'DomainError'
    this.code = code
    this.fieldErrors = fieldErrors
  }
}
