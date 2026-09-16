import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { computeLineSignature, verifyLineSignature } from '@/modules/line/signature'

// [C] modules/line/__tests__/signature.test.ts: no DB needed. Covers the
// section 10 acceptance rows for HMAC compute/verify: valid, tampered, wrong
// secret, null/empty/length-mismatch signature, and "never throws".

const SECRET = 'test-channel-secret'
const THAI_BODY = 'สวัสดีครับ นี่คือข้อความทดสอบ'

describe('computeLineSignature', () => {
  it('matches an independently computed HMAC-SHA256 base64 digest', () => {
    const body = 'hello world'
    const expected = createHmac('sha256', SECRET).update(body).digest('base64')
    expect(computeLineSignature(SECRET, body)).toBe(expected)
  })

  it('gives the same signature for an equivalent Buffer and string input', () => {
    const body = 'hello world'
    const fromString = computeLineSignature(SECRET, body)
    const fromBuffer = computeLineSignature(SECRET, Buffer.from(body, 'utf8'))
    expect(fromBuffer).toBe(fromString)
  })

  it('handles a Thai body the same way for Buffer and string input', () => {
    const fromString = computeLineSignature(SECRET, THAI_BODY)
    const fromBuffer = computeLineSignature(SECRET, Buffer.from(THAI_BODY, 'utf8'))
    const expected = createHmac('sha256', SECRET).update(Buffer.from(THAI_BODY, 'utf8')).digest('base64')
    expect(fromString).toBe(expected)
    expect(fromBuffer).toBe(expected)
  })
})

describe('verifyLineSignature', () => {
  it('returns true for a valid signature', () => {
    const body = Buffer.from('hello world', 'utf8')
    const sig = computeLineSignature(SECRET, body)
    expect(verifyLineSignature(SECRET, body, sig)).toBe(true)
  })

  it('returns true for a valid signature over a Thai body', () => {
    const body = Buffer.from(THAI_BODY, 'utf8')
    const sig = computeLineSignature(SECRET, body)
    expect(verifyLineSignature(SECRET, body, sig)).toBe(true)
  })

  it('returns false for a wrong signature of the same length', () => {
    const body = Buffer.from('hello world', 'utf8')
    const sig = computeLineSignature(SECRET, body)
    const flipped = sig[0] === 'A' ? 'B' + sig.slice(1) : 'A' + sig.slice(1)
    expect(verifyLineSignature(SECRET, body, flipped)).toBe(false)
  })

  it('returns false for a null signature', () => {
    const body = Buffer.from('hello world', 'utf8')
    expect(verifyLineSignature(SECRET, body, null)).toBe(false)
  })

  it('returns false for an undefined signature', () => {
    const body = Buffer.from('hello world', 'utf8')
    expect(verifyLineSignature(SECRET, body, undefined)).toBe(false)
  })

  it('returns false for an empty string signature', () => {
    const body = Buffer.from('hello world', 'utf8')
    expect(verifyLineSignature(SECRET, body, '')).toBe(false)
  })

  it('returns false for a signature of a different length', () => {
    const body = Buffer.from('hello world', 'utf8')
    const sig = computeLineSignature(SECRET, body)
    expect(verifyLineSignature(SECRET, body, sig + 'A')).toBe(false)
  })

  it('returns false when one body byte is tampered (flipped)', () => {
    const body = Buffer.from('hello world', 'utf8')
    const sig = computeLineSignature(SECRET, body)
    const tampered = Buffer.from(body)
    tampered[0] = tampered[0] ^ 0xff
    expect(verifyLineSignature(SECRET, tampered, sig)).toBe(false)
  })

  it('returns false for the wrong secret', () => {
    const body = Buffer.from('hello world', 'utf8')
    const sig = computeLineSignature(SECRET, body)
    expect(verifyLineSignature('a-different-secret', body, sig)).toBe(false)
  })

  it('returns false for an empty secret', () => {
    const body = Buffer.from('hello world', 'utf8')
    const sig = computeLineSignature(SECRET, body)
    expect(verifyLineSignature('', body, sig)).toBe(false)
  })

  it('returns false for a 10k-char garbage signature, without throwing', () => {
    const body = Buffer.from('hello world', 'utf8')
    const garbage = 'x'.repeat(10000)
    expect(() => verifyLineSignature(SECRET, body, garbage)).not.toThrow()
    expect(verifyLineSignature(SECRET, body, garbage)).toBe(false)
  })
})
