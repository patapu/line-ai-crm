import { z } from 'zod'

// [F] lib/contracts/common.ts: see docs/design.md section 3. Zod 4 top
// level formats: z.cuid(), z.email(), z.iso.datetime() (verified against
// node_modules/zod/src/v4/classic/schemas.ts before writing this).

export const IdSchema = z.cuid()

export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export const ErrorCode = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'UNPROCESSABLE',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
  'INTERNAL',
])

export const ApiErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    requestId: z.string(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  }),
})

export type ApiErrorBody = z.infer<typeof ApiErrorBody>

export type Paged<T> = { items: T[]; page: number; pageSize: number; total: number }
