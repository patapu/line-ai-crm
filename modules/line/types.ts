// [F] modules/line/types.ts: see docs/design.md section 4 and section 10.
//
// `PushResult.retryable` semantics per section 10 (overrides the original
// section 4 wording): true only for NETWORK, TIMEOUT and 5xx (SERVER). 429
// (RATE_LIMITED) is explicitly NOT retryable within the same request: LINE
// advises against retrying any 4xx automatically, and surfacing it as a
// FAILED message that the user can retry by hand is our own product choice,
// not a LINE recommendation.

export type LineTextMessage = { type: 'text'; text: string }
export type LineOutboundMessage = LineTextMessage // Flex later

export type PushResult =
  | {
      ok: true
      httpStatus: 200 | 409
      /** From x-line-request-id on a 200, from x-line-accepted-request-id on a 409. */
      requestId: string | null
      duplicate: boolean
    }
  | {
      ok: false
      httpStatus: number | null
      retryable: boolean
      errorCode: 'NETWORK' | 'TIMEOUT' | 'RATE_LIMITED' | 'SERVER' | 'CLIENT' | 'CONFIG'
      message: string
      /** Same x-line-request-id / x-line-accepted-request-id headers, when LINE returned one. */
      requestId: string | null
    }

export interface LineProfile {
  userId: string
  displayName: string
  pictureUrl?: string
}

export interface LineClient {
  readonly mode: 'live' | 'mock'
  /**
   * base64(HMAC_SHA256(channelSecret, rawBody)) vs x-line-signature,
   * timingSafeEqual after a length check. Called BEFORE JSON.parse. Never
   * throws.
   */
  verifySignature(rawBody: Buffer, signature: string | null): boolean
  /**
   * POST https://api.line.me/v2/bot/message/push, header X-Line-Retry-Key:
   * retryKey, AbortSignal.timeout(5000). Never throws. 409 on a reused key =>
   * ok:true, duplicate:true. retryable: see section 10 (NETWORK | TIMEOUT |
   * 5xx only). 401/403 => CONFIG, not retryable.
   */
  push(to: string, messages: LineOutboundMessage[], retryKey: string): Promise<PushResult>
  /** Best effort, null on failure. Only called inside after(). */
  getProfile(userId: string): Promise<LineProfile | null>
}
