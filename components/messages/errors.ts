// [C] components/messages/errors.ts: shared by Composer.tsx and
// MessageBubble.tsx. Reads the frozen `{ error: { message } }` response
// shape defensively, since a route can fail before it ever produces that
// shape (a proxy 502, a malformed body), and `res.json()` itself can throw.

export function readErrorMessage(json: unknown, status: number): string {
  if (json && typeof json === 'object') {
    const err = (json as { error?: unknown }).error
    if (err && typeof err === 'object') {
      const message = (err as { message?: unknown }).message
      if (typeof message === 'string') {
        return message
      }
    }
  }
  return 'Request failed (' + status + ')'
}
