// [C] components/messages/errors.ts: shared by Composer.tsx and
// MessageBubble.tsx. Reads the frozen `{ error: { message } }` response
// shape defensively, since a route can fail before it ever produces that
// shape (a proxy 502, a malformed body), and `res.json()` itself can throw.

function genericMessage(status: number): string {
  if (status === 401) return 'เซสชันหมดอายุ เข้าสู่ระบบใหม่แล้วลองอีกครั้ง'
  if (status === 403) return 'คุณไม่มีสิทธิ์ทำรายการนี้'
  if (status === 404) return 'ไม่พบข้อมูลนี้แล้ว รีเฟรชหน้าเพื่อดูข้อมูลล่าสุด'
  if (status === 429) return 'ทำรายการถี่เกินไป รอสักครู่แล้วลองใหม่'
  if (status >= 500) return 'ระบบทำรายการไม่สำเร็จ ลองใหม่อีกครั้งในอีกสักครู่'
  return 'ระบบทำรายการไม่สำเร็จ ลองใหม่อีกครั้งในอีกสักครู่'
}

export function readErrorMessage(json: unknown, status: number): string {
  if (status === 401 || status === 403 || status === 404 || status === 429 || status >= 500) {
    return genericMessage(status)
  }
  if (json && typeof json === 'object') {
    const err = (json as { error?: unknown }).error
    if (err && typeof err === 'object') {
      const message = (err as { message?: unknown }).message
      if (typeof message === 'string') {
        return message
      }
    }
  }
  return genericMessage(status)
}
