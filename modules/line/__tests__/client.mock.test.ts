import { describe, expect, it } from 'vitest'
import { MockLineClient } from '@/modules/line/client.mock'

// [C] modules/line/__tests__/client.mock.test.ts: no DB needed. Covers the
// design lines 602-621 push/sign/verify/failNext/reset behavior.

describe('MockLineClient sign/verify', () => {
  it('round trips sign then verify', () => {
    const client = new MockLineClient('secret-a')
    const body = Buffer.from('hello', 'utf8')
    const sig = client.sign(body)
    expect(client.verifySignature(body, sig)).toBe(true)
  })

  it('fails verification for a tampered body', () => {
    const client = new MockLineClient('secret-a')
    const body = Buffer.from('hello', 'utf8')
    const sig = client.sign(body)
    const tampered = Buffer.from('hellO', 'utf8')
    expect(client.verifySignature(tampered, sig)).toBe(false)
  })

  it('fails verification for a client with another secret', () => {
    const client = new MockLineClient('secret-a')
    const other = new MockLineClient('secret-b')
    const body = Buffer.from('hello', 'utf8')
    const sig = client.sign(body)
    expect(other.verifySignature(body, sig)).toBe(false)
  })
})

describe('MockLineClient push', () => {
  it('gives sequential requestIds and records two sent entries for two keys', async () => {
    const client = new MockLineClient('secret-a')
    const r1 = await client.push('U1', [{ type: 'text', text: 'a' }], 'key-1')
    const r2 = await client.push('U1', [{ type: 'text', text: 'b' }], 'key-2')
    expect(r1).toMatchObject({ ok: true, httpStatus: 200, duplicate: false, requestId: 'mock-1' })
    expect(r2).toMatchObject({ ok: true, httpStatus: 200, duplicate: false, requestId: 'mock-2' })
    expect(client.sent).toHaveLength(2)
  })

  it('gives a 409 duplicate with the original requestId when a key is reused, without growing sent', async () => {
    const client = new MockLineClient('secret-a')
    const first = await client.push('U1', [{ type: 'text', text: 'a' }], 'key-1')
    expect(first.ok).toBe(true)
    const originalRequestId = first.ok ? first.requestId : null

    const second = await client.push('U1', [{ type: 'text', text: 'a again' }], 'key-1')
    expect(second).toMatchObject({ ok: true, httpStatus: 409, duplicate: true, requestId: originalRequestId })
    expect(client.sent).toHaveLength(1)
  })

  it('failNext(2) gives two SERVER/500/retryable failures with nothing recorded, then a success', async () => {
    const client = new MockLineClient('secret-a')
    client.failNext(2)

    const r1 = await client.push('U1', [{ type: 'text', text: 'a' }], 'key-1')
    const r2 = await client.push('U1', [{ type: 'text', text: 'a' }], 'key-1')
    expect(r1).toMatchObject({ ok: false, errorCode: 'SERVER', httpStatus: 500, retryable: true })
    expect(r2).toMatchObject({ ok: false, errorCode: 'SERVER', httpStatus: 500, retryable: true })
    expect(client.sent).toHaveLength(0)

    const r3 = await client.push('U1', [{ type: 'text', text: 'a' }], 'key-1')
    expect(r3).toMatchObject({ ok: true, httpStatus: 200, duplicate: false })
    expect(client.sent).toHaveLength(1)
  })

  it('failNext(1, { errorCode: "CONFIG" }) gives 401 and retryable false', async () => {
    const client = new MockLineClient('secret-a')
    client.failNext(1, { errorCode: 'CONFIG' })
    const result = await client.push('U1', [{ type: 'text', text: 'a' }], 'key-1')
    expect(result).toMatchObject({ ok: false, errorCode: 'CONFIG', httpStatus: 401, retryable: false })
  })

  it('failNext(1, { errorCode: "RATE_LIMITED" }) gives 429 and retryable false', async () => {
    const client = new MockLineClient('secret-a')
    client.failNext(1, { errorCode: 'RATE_LIMITED' })
    const result = await client.push('U1', [{ type: 'text', text: 'a' }], 'key-1')
    expect(result).toMatchObject({ ok: false, errorCode: 'RATE_LIMITED', httpStatus: 429, retryable: false })
  })

  it('getProfile returns a Mock-prefixed display name from the last 4 chars', async () => {
    const client = new MockLineClient('secret-a')
    const profile = await client.getProfile('Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxabcd')
    expect(profile).toEqual({ userId: 'Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxabcd', displayName: 'Mock abcd' })
  })

  it('after reset, the same key gives 200 again', async () => {
    const client = new MockLineClient('secret-a')
    await client.push('U1', [{ type: 'text', text: 'a' }], 'key-1')
    client.reset()
    const result = await client.push('U1', [{ type: 'text', text: 'a' }], 'key-1')
    expect(result).toMatchObject({ ok: true, httpStatus: 200, duplicate: false, requestId: 'mock-1' })
    expect(client.sent).toHaveLength(1)
  })
})

describe('MockLineClient setProfileName', () => {
  it('getProfile defaults to Mock-prefixed last 4 chars of the userId', async () => {
    const client = new MockLineClient('secret-a')
    const profile = await client.getProfile('Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxabcd')
    expect(profile).toEqual({ userId: 'Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxabcd', displayName: 'Mock abcd' })
  })

  it('getProfile returns the name set by setProfileName', async () => {
    const client = new MockLineClient('secret-a')
    client.setProfileName('U1', 'สมชาย ใจดี')
    const profile = await client.getProfile('U1')
    expect(profile).toEqual({ userId: 'U1', displayName: 'สมชาย ใจดี' })
  })

  it('reset() restores the default Mock-prefixed name', async () => {
    const client = new MockLineClient('secret-a')
    client.setProfileName('U1', 'Custom Name')
    client.reset()
    const profile = await client.getProfile('U1')
    expect(profile).toEqual({ userId: 'U1', displayName: 'Mock ' + 'U1'.slice(-4) })
  })
})
