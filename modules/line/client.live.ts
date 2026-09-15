// [C] modules/line/client.live.ts: see docs/design.md section 4 and section 10.
//
// Talks to the real LINE Messaging API. Never throws: every failure path
// (thrown error, non-2xx response) is mapped onto a PushResult / null. Never
// puts the access token, a request header, or the raw upstream error text
// into a returned `message`.

import type { LineClient, LineOutboundMessage, LineProfile, PushResult } from '@/modules/line/types'
import { verifyLineSignature } from '@/modules/line/signature'
import { classifyHttpFailure } from '@/modules/line/push-result'

const PUSH_URL = 'https://api.line.me/v2/bot/message/push'
const PROFILE_URL = 'https://api.line.me/v2/bot/profile/'
const TIMEOUT_MS = 5000

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

/** Best-effort extraction of LINE's { message: string } error body. Never throws. */
function parseLineErrorMessage(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && typeof (parsed as { message?: unknown }).message === 'string') {
      return (parsed as { message: string }).message
    }
  } catch {
    // unparsable body: fall through to an empty message
  }
  return ''
}

export class LiveLineClient implements LineClient {
  readonly mode = 'live' as const

  constructor(
    private readonly channelSecret: string,
    private readonly accessToken: string,
    // Lazy wrapper (instead of passing `fetch` itself) lets tests stub the global.
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  verifySignature(rawBody: Buffer, signature: string | null): boolean {
    return verifyLineSignature(this.channelSecret, rawBody, signature)
  }

  async push(to: string, messages: LineOutboundMessage[], retryKey: string): Promise<PushResult> {
    try {
      const res = await this.fetchImpl(PUSH_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + this.accessToken,
          'x-line-retry-key': retryKey,
        },
        body: JSON.stringify({ to, messages }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      const reqId = res.headers.get('x-line-request-id')
      const accepted = res.headers.get('x-line-accepted-request-id')

      let bodyText = ''
      try {
        bodyText = await res.text()
      } catch {
        // draining the body is best-effort; classification below does not need it to succeed
      }

      if (res.status === 409) {
        return { ok: true, httpStatus: 409, duplicate: true, requestId: accepted ?? reqId }
      }
      if (res.ok) {
        return { ok: true, httpStatus: 200, duplicate: false, requestId: reqId }
      }

      const { errorCode, retryable } = classifyHttpFailure(res.status)
      const message = ('LINE ' + res.status + ': ' + parseLineErrorMessage(bodyText)).slice(0, 200)
      return { ok: false, httpStatus: res.status, retryable, errorCode, message, requestId: reqId }
    } catch (err) {
      if (isTimeout(err)) {
        return {
          ok: false,
          httpStatus: null,
          retryable: true,
          errorCode: 'TIMEOUT',
          message: 'LINE push timed out after ' + TIMEOUT_MS + 'ms',
          requestId: null,
        }
      }
      return {
        ok: false,
        httpStatus: null,
        retryable: true,
        errorCode: 'NETWORK',
        message: 'LINE push network error',
        requestId: null,
      }
    }
  }

  async getProfile(userId: string): Promise<LineProfile | null> {
    try {
      const res = await this.fetchImpl(PROFILE_URL + encodeURIComponent(userId), {
        headers: { authorization: 'Bearer ' + this.accessToken },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) return null

      const json: unknown = await res.json()
      if (
        json &&
        typeof json === 'object' &&
        typeof (json as { userId?: unknown }).userId === 'string' &&
        typeof (json as { displayName?: unknown }).displayName === 'string'
      ) {
        const profile = json as { userId: string; displayName: string; pictureUrl?: unknown }
        return {
          userId: profile.userId,
          displayName: profile.displayName,
          ...(typeof profile.pictureUrl === 'string' ? { pictureUrl: profile.pictureUrl } : {}),
        }
      }
      return null
    } catch {
      return null
    }
  }
}
