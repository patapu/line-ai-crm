// [C] modules/line/client.ts: see docs/design.md section 4 and section 10.
//
// `getLineClient()` signature is frozen per section 4: `LINE_MODE=mock|live`,
// memoized per process. Cached on globalThis (same pattern as lib/db.ts), so
// the mock client's in-memory `sent` array survives HMR in dev instead of
// being recreated on every module reload.

import { DomainError } from '@/lib/errors'
import { getEnv } from '@/lib/env'
import type { LineClient } from '@/modules/line/types'
import { MockLineClient } from '@/modules/line/client.mock'
import { LiveLineClient } from '@/modules/line/client.live'

/** Only used in mock mode when LINE_CHANNEL_SECRET is unset (local dev / tests). */
export const MOCK_DEFAULT_CHANNEL_SECRET = 'mock-channel-secret-local-only'

const globalForLine = globalThis as unknown as { __crmLineClient?: LineClient }

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
  return new MockLineClient(env.LINE_CHANNEL_SECRET ?? MOCK_DEFAULT_CHANNEL_SECRET)
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
