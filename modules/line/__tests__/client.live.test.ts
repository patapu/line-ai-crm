import { describe, expect, it, vi } from 'vitest'
import { LiveLineClient } from '@/modules/line/client.live'

// [C] modules/line/__tests__/client.live.test.ts: no DB, no real network.
// `fetchImpl` is stubbed to return `new Response(...)` directly, per the
// design's injectable-fetch seam. Covers the section 10 status mapping table,
// the 409 accepted-request-id rule, thrown-error mapping, and "the token
// never appears in JSON.stringify(result)".

const TOKEN = 'tok-SECRET-123'
const SECRET = 'chan-secret'

describe('LiveLineClient.push request shape', () => {
  it('sends the right URL, method, headers, body and an abort signal', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response('{}', { status: 200, headers: { 'x-line-request-id': 'req-1' } }),
    )
    const client = new LiveLineClient(SECRET, TOKEN, fetchImpl)

    await client.push('U1', [{ type: 'text', text: 'hi' }], 'retry-key-1')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.line.me/v2/bot/message/push')
    expect(init?.method).toBe('POST')
    const headers = init?.headers as Record<string, string>
    expect(headers['content-type']).toBe('application/json')
    expect(headers['authorization']).toBe('Bearer ' + TOKEN)
    expect(headers['x-line-retry-key']).toBe('retry-key-1')
    expect(init?.body).toBe(JSON.stringify({ to: 'U1', messages: [{ type: 'text', text: 'hi' }] }))
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})

type StatusCase = {
  status: number
  expectedErrorCode?: 'CONFIG' | 'RATE_LIMITED' | 'SERVER' | 'CLIENT'
  expectedRetryable: boolean
}

const STATUS_CASES: StatusCase[] = [
  { status: 200, expectedRetryable: false },
  { status: 400, expectedErrorCode: 'CLIENT', expectedRetryable: false },
  { status: 401, expectedErrorCode: 'CONFIG', expectedRetryable: false },
  { status: 403, expectedErrorCode: 'CONFIG', expectedRetryable: false },
  { status: 404, expectedErrorCode: 'CLIENT', expectedRetryable: false },
  { status: 409, expectedRetryable: false },
  { status: 429, expectedErrorCode: 'RATE_LIMITED', expectedRetryable: false },
  { status: 500, expectedErrorCode: 'SERVER', expectedRetryable: true },
  { status: 502, expectedErrorCode: 'SERVER', expectedRetryable: true },
  { status: 503, expectedErrorCode: 'SERVER', expectedRetryable: true },
  { status: 504, expectedErrorCode: 'SERVER', expectedRetryable: true },
]

describe('LiveLineClient.push status mapping', () => {
  for (const testCase of STATUS_CASES) {
    it('maps status ' + testCase.status + ' correctly', async () => {
      const fetchImpl = vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'boom' }), {
            status: testCase.status,
            headers: { 'x-line-request-id': 'req-' + testCase.status },
          }),
      )
      const client = new LiveLineClient(SECRET, TOKEN, fetchImpl)
      const result = await client.push('U1', [{ type: 'text', text: 'hi' }], 'k')

      if (testCase.status === 200) {
        expect(result).toMatchObject({ ok: true, httpStatus: 200, duplicate: false, requestId: 'req-200' })
      } else if (testCase.status === 409) {
        expect(result).toMatchObject({ ok: true, httpStatus: 409, duplicate: true })
      } else {
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.errorCode).toBe(testCase.expectedErrorCode)
          expect(result.retryable).toBe(testCase.expectedRetryable)
        }
      }
      expect(JSON.stringify(result)).not.toContain(TOKEN)
    })
  }

  it('409 takes requestId from x-line-accepted-request-id, not x-line-request-id', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('{}', {
          status: 409,
          headers: {
            'x-line-request-id': 'req-original',
            'x-line-accepted-request-id': 'req-accepted',
          },
        }),
    )
    const client = new LiveLineClient(SECRET, TOKEN, fetchImpl)
    const result = await client.push('U1', [{ type: 'text', text: 'hi' }], 'k')
    expect(result).toMatchObject({ ok: true, httpStatus: 409, duplicate: true, requestId: 'req-accepted' })
  })
})

describe('LiveLineClient.push thrown errors', () => {
  it('maps a TimeoutError rejection to TIMEOUT, retryable, null status', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('timed out', 'TimeoutError')
    })
    const client = new LiveLineClient(SECRET, TOKEN, fetchImpl)
    const result = await client.push('U1', [{ type: 'text', text: 'hi' }], 'k')
    expect(result).toMatchObject({ ok: false, errorCode: 'TIMEOUT', retryable: true, httpStatus: null })
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })

  it('maps a TypeError("fetch failed") rejection to NETWORK, retryable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const client = new LiveLineClient(SECRET, TOKEN, fetchImpl)
    const result = await client.push('U1', [{ type: 'text', text: 'hi' }], 'k')
    expect(result).toMatchObject({ ok: false, errorCode: 'NETWORK', retryable: true, httpStatus: null })
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })
})

describe('LiveLineClient.getProfile', () => {
  it('returns the profile on a 200 with valid JSON', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ userId: 'U1', displayName: 'Alice' }), { status: 200 }),
    )
    const client = new LiveLineClient(SECRET, TOKEN, fetchImpl)
    const profile = await client.getProfile('U1')
    expect(profile).toEqual({ userId: 'U1', displayName: 'Alice' })
  })

  it('returns null on a 404', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 404 }))
    const client = new LiveLineClient(SECRET, TOKEN, fetchImpl)
    expect(await client.getProfile('U1')).toBeNull()
  })

  it('returns null when fetch rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const client = new LiveLineClient(SECRET, TOKEN, fetchImpl)
    expect(await client.getProfile('U1')).toBeNull()
  })

  it('returns null on bad JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 }))
    const client = new LiveLineClient(SECRET, TOKEN, fetchImpl)
    expect(await client.getProfile('U1')).toBeNull()
  })
})
