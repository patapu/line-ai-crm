// [C] modules/line/push-result.ts: see docs/design.md section 10.
//
// One source for the retryable rule and the HTTP status classification, used
// by both MockLineClient and LiveLineClient.

import type { PushResult } from '@/modules/line/types'

export type PushFailure = Extract<PushResult, { ok: false }>

/** Per section 10: retryable only for NETWORK, TIMEOUT and SERVER (5xx). */
export function isRetryableErrorCode(code: PushFailure['errorCode']): boolean {
  return code === 'NETWORK' || code === 'TIMEOUT' || code === 'SERVER'
}

/**
 * Maps a LINE push HTTP status onto an errorCode and its retryable flag.
 * 401/403 => CONFIG (not retryable): a bad channel access token will not fix
 * itself on retry. 429 => RATE_LIMITED (not retryable within this request,
 * per section 10). 5xx => SERVER (retryable). Anything else => CLIENT.
 */
export function classifyHttpFailure(status: number): {
  errorCode: 'CONFIG' | 'RATE_LIMITED' | 'SERVER' | 'CLIENT'
  retryable: boolean
} {
  if (status === 401 || status === 403) return { errorCode: 'CONFIG', retryable: false }
  if (status === 429) return { errorCode: 'RATE_LIMITED', retryable: false }
  if (status >= 500) return { errorCode: 'SERVER', retryable: true }
  return { errorCode: 'CLIENT', retryable: false }
}

export const DEFAULT_HTTP_STATUS: Record<PushFailure['errorCode'], number | null> = {
  CONFIG: 401,
  RATE_LIMITED: 429,
  SERVER: 500,
  CLIENT: 400,
  NETWORK: null,
  TIMEOUT: null,
}
