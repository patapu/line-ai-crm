// [C] modules/line/client.mock.ts: see docs/design.md section 4 (lines
// 602-621) and section 10.
//
// In-memory LineClient used when LINE_MODE=mock. Uses the real HMAC from
// signature.ts, so the security tests exercise real signature verification.
// `sent` lives only in process memory: that is fine, because the source of
// truth for delivery is the Message row in the DB, not this array.

import type { LineClient, LineOutboundMessage, LineProfile, PushResult } from '@/modules/line/types'
import { computeLineSignature, verifyLineSignature } from '@/modules/line/signature'
import { DEFAULT_HTTP_STATUS, isRetryableErrorCode, type PushFailure } from '@/modules/line/push-result'

export class MockLineClient implements LineClient {
  readonly mode = 'mock' as const
  readonly sent: Array<{ to: string; messages: LineOutboundMessage[]; retryKey: string; at: Date }> = []

  private failures: PushFailure[] = []
  private acceptedRequestIds = new Map<string, string>()
  private counter = 0

  constructor(private readonly channelSecret: string) {}

  verifySignature(rawBody: Buffer, signature: string | null): boolean {
    return verifyLineSignature(this.channelSecret, rawBody, signature)
  }

  sign(rawBody: Buffer | string): string {
    return computeLineSignature(this.channelSecret, rawBody)
  }

  /** Queues n failures to be returned by the next n calls to push(), before any success. */
  failNext(n: number, failure: Partial<PushFailure> = {}): void {
    const errorCode = failure.errorCode ?? 'SERVER'
    const httpStatus = failure.httpStatus ?? DEFAULT_HTTP_STATUS[errorCode]
    const retryable = failure.retryable ?? isRetryableErrorCode(errorCode)
    for (let i = 0; i < n; i++) {
      this.failures.push({
        ok: false,
        errorCode,
        httpStatus,
        retryable,
        message: 'mock ' + errorCode,
        requestId: null,
        ...failure,
      })
    }
  }

  async push(to: string, messages: LineOutboundMessage[], retryKey: string): Promise<PushResult> {
    const queued = this.failures.shift()
    if (queued) return queued

    const existing = this.sent.find((s) => s.retryKey === retryKey)
    if (existing) {
      return { ok: true, httpStatus: 409, duplicate: true, requestId: this.acceptedRequestIds.get(retryKey) ?? null }
    }

    this.counter += 1
    const requestId = 'mock-' + this.counter
    this.sent.push({ to, messages: [...messages], retryKey, at: new Date() })
    this.acceptedRequestIds.set(retryKey, requestId)
    return { ok: true, httpStatus: 200, duplicate: false, requestId }
  }

  async getProfile(userId: string): Promise<LineProfile> {
    return { userId, displayName: 'Mock ' + userId.slice(-4) }
  }

  reset(): void {
    this.sent.length = 0
    this.failures = []
    this.acceptedRequestIds.clear()
    this.counter = 0
  }
}
