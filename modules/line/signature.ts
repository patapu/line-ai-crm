// [C] modules/line/signature.ts: see docs/design.md section 4 and section 10.
//
// The single HMAC implementation shared by MockLineClient and LiveLineClient,
// so the security tests exercise real signature verification either way. No
// `server-only` import: plain scripts (and the mock client) must be able to
// import this from outside a request.

import { createHmac, timingSafeEqual } from 'node:crypto'

/** base64(HMAC_SHA256(channelSecret, rawBody)), matched against x-line-signature. */
export function computeLineSignature(channelSecret: string, rawBody: Buffer | string): string {
  return createHmac('sha256', channelSecret).update(rawBody).digest('base64')
}

/**
 * Never throws. False when the secret or signature is empty/absent, or on any
 * unexpected error. Compares the base64 STRINGS via timingSafeEqual (after a
 * length check), not the decoded bytes: `Buffer.from(x, 'base64')` is lenient
 * about non-canonical encodings, which would let a tampered signature slip
 * through as "equal" bytes.
 */
export function verifyLineSignature(
  channelSecret: string,
  rawBody: Buffer,
  signature: string | null | undefined,
): boolean {
  try {
    if (!channelSecret || !signature) return false
    const expected = computeLineSignature(channelSecret, rawBody)
    if (expected.length !== signature.length) return false
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'))
  } catch {
    return false
  }
}
