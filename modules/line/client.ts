// [C] modules/line/client.ts: see docs/design.md section 4 and section 10.
//
// `getLineClient()` signature is frozen per section 4: `LINE_MODE=mock|live`,
// memoized per process. Cached on globalThis (same pattern as lib/db.ts), so
// the mock client's in-memory `sent` array survives HMR in dev instead of
// being recreated on every module reload.

import { randomBytes } from 'node:crypto'
import { DomainError } from '@/lib/errors'
import { getEnv } from '@/lib/env'
import { log } from '@/lib/log'
import type { LineClient } from '@/modules/line/types'
import { MockLineClient } from '@/modules/line/client.mock'
import { LiveLineClient } from '@/modules/line/client.live'

/**
 * Only used in mock mode when LINE_CHANNEL_SECRET is unset, in dev or test:
 * tests rely on this exact value to sign requests. In a production
 * deployment running mock mode with no configured secret, buildLineClient()
 * generates a random per-process secret instead, so the public webhook route
 * cannot be forged with this well-known constant.
 */
export const MOCK_DEFAULT_CHANNEL_SECRET = 'mock-channel-secret-local-only'

const globalForLine = globalThis as unknown as { __crmLineClient?: LineClient }

function mockChannelSecret(configured: string | undefined): string {
  if (configured) return configured
  if (process.env.NODE_ENV === 'production') {
    log('warn', 'line.mock_secret_random')
    return randomBytes(32).toString('base64')
  }
  return MOCK_DEFAULT_CHANNEL_SECRET
}

function buildLineClient(): LineClient {
  const env = getEnv()
  if (env.LINE_MODE === 'live') {
    if (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN) {
      // getEnv()'s superRefine should already prevent this; guard anyway so
      // we never fall through to `new LiveLineClient` with a missing value.
      throw new DomainError('INTERNAL', 'LINE live mode is misconfigured')
    }
    return new LiveLineClient(env.LINE_CHANNEL_SECRET, env.LINE_CHANNEL_ACCESS_TOKEN)
  }
  return new MockLineClient(mockChannelSecret(env.LINE_CHANNEL_SECRET))
}

export function getLineClient(): LineClient {
  if (!globalForLine.__crmLineClient) {
    globalForLine.__crmLineClient = buildLineClient()
  }
  return globalForLine.__crmLineClient
}

/** Test-only: drops the memoized client so the next getLineClient() call rebuilds it. */
export function resetLineClientForTests(): void {
  delete globalForLine.__crmLineClient
}
