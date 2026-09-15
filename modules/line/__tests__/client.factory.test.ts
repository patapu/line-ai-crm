import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLineClient, resetLineClientForTests } from '@/modules/line/client'
import { MockLineClient } from '@/modules/line/client.mock'

// [C] modules/line/__tests__/client.factory.test.ts: no DB needed. Covers
// getLineClient() memoization, resetLineClientForTests(), the no-secret
// fallback, and live-mode construction via a fresh module registry.

afterEach(() => {
  resetLineClientForTests()
})

describe('getLineClient in mock mode (the vitest.setup.ts default)', () => {
  it('returns a MockLineClient, memoized as the same instance', () => {
    const a = getLineClient()
    const b = getLineClient()
    expect(a).toBeInstanceOf(MockLineClient)
    expect(a).toBe(b)
  })

  it('returns a new instance after resetLineClientForTests()', () => {
    const a = getLineClient()
    resetLineClientForTests()
    const b = getLineClient()
    expect(b).toBeInstanceOf(MockLineClient)
    expect(b).not.toBe(a)
  })

  it('round trips sign/verify using the default secret when LINE_CHANNEL_SECRET is unset', () => {
    expect(process.env.LINE_CHANNEL_SECRET).toBeFalsy()
    const client = getLineClient() as MockLineClient
    const body = Buffer.from('hello', 'utf8')
    const sig = client.sign(body)
    expect(client.verifySignature(body, sig)).toBe(true)
  })
})

describe('getLineClient in mock mode with NODE_ENV=production and no configured secret', () => {
  it('uses a random per-process secret: the well-known mock secret no longer verifies, but the client sign()/verifySignature() still round-trip', async () => {
    const originalSecret = process.env.LINE_CHANNEL_SECRET
    const originalMode = process.env.LINE_MODE

    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.LINE_CHANNEL_SECRET
    process.env.LINE_MODE = 'mock'

    try {
      const { computeLineSignature } = await import('@/modules/line/signature')
      const clientModule = await import('@/modules/line/client')
      const client = clientModule.getLineClient() as MockLineClient
      expect(client.mode).toBe('mock')

      const body = Buffer.from('production mock secret check', 'utf8')

      // The well-known constant (used only in dev/test when no secret is
      // configured) must NOT verify: buildLineClient() should have generated
      // a random secret instead, precisely because NODE_ENV is production.
      const sigWithWellKnownSecret = computeLineSignature(clientModule.MOCK_DEFAULT_CHANNEL_SECRET, body)
      expect(client.verifySignature(body, sigWithWellKnownSecret)).toBe(false)

      // The client's own (random) secret still round-trips normally.
      const ownSignature = client.sign(body)
      expect(client.verifySignature(body, ownSignature)).toBe(true)

      clientModule.resetLineClientForTests()
    } finally {
      vi.unstubAllEnvs()
      if (originalSecret === undefined) delete process.env.LINE_CHANNEL_SECRET
      else process.env.LINE_CHANNEL_SECRET = originalSecret
      if (originalMode === undefined) delete process.env.LINE_MODE
      else process.env.LINE_MODE = originalMode
      vi.resetModules()
    }
  })
})

describe('getLineClient in live mode', () => {
  it('builds a LiveLineClient when LINE_MODE=live with a secret and token set', async () => {
    const originalMode = process.env.LINE_MODE
    const originalSecret = process.env.LINE_CHANNEL_SECRET
    const originalToken = process.env.LINE_CHANNEL_ACCESS_TOKEN

    vi.resetModules()
    process.env.LINE_MODE = 'live'
    process.env.LINE_CHANNEL_SECRET = 'fake-live-secret'
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'fake-live-token'

    try {
      const freshClientModule = await import('@/modules/line/client')
      const client = freshClientModule.getLineClient()
      expect(client.mode).toBe('live')
      freshClientModule.resetLineClientForTests()
    } finally {
      if (originalMode === undefined) delete process.env.LINE_MODE
      else process.env.LINE_MODE = originalMode
      if (originalSecret === undefined) delete process.env.LINE_CHANNEL_SECRET
      else process.env.LINE_CHANNEL_SECRET = originalSecret
      if (originalToken === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN
      else process.env.LINE_CHANNEL_ACCESS_TOKEN = originalToken
      vi.resetModules()
    }
  })
})
