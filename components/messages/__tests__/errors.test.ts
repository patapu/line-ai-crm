import { describe, expect, it } from 'vitest'
import { readErrorMessage } from '@/components/messages/errors'

// [D-tester] components/messages/__tests__/errors.test.ts
// Unit coverage for readErrorMessage's Thai status mapping (S1 lane C
// change): 401/403/404/429/500 always use the generic Thai copy for that
// status even if the server sent its own message; a 409 keeps the server
// message when present, and falls back to the generic Thai copy when it
// is not.

describe('readErrorMessage', () => {
  it('returns the Thai session-expired message for 401, ignoring any server message', () => {
    expect(readErrorMessage({ error: { message: 'server says something else' } }, 401)).toBe(
      'เซสชันหมดอายุ เข้าสู่ระบบใหม่แล้วลองอีกครั้ง',
    )
  })

  it('returns the Thai forbidden message for 403', () => {
    expect(readErrorMessage(null, 403)).toBe('คุณไม่มีสิทธิ์ทำรายการนี้')
  })

  it('returns the Thai not-found message for 404', () => {
    expect(readErrorMessage(null, 404)).toBe('ไม่พบข้อมูลนี้แล้ว รีเฟรชหน้าเพื่อดูข้อมูลล่าสุด')
  })

  it('returns the Thai rate-limit message for 429', () => {
    expect(readErrorMessage(null, 429)).toBe('ทำรายการถี่เกินไป รอสักครู่แล้วลองใหม่')
  })

  it('returns the generic Thai failure message for 500', () => {
    expect(readErrorMessage(null, 500)).toBe('ระบบทำรายการไม่สำเร็จ ลองใหม่อีกครั้งในอีกสักครู่')
  })

  it('returns the generic Thai failure message for any 5xx status', () => {
    expect(readErrorMessage(null, 503)).toBe('ระบบทำรายการไม่สำเร็จ ลองใหม่อีกครั้งในอีกสักครู่')
  })

  it('keeps the server-provided message for 409 when present', () => {
    expect(readErrorMessage({ error: { message: 'สถานะข้อมูลเปลี่ยนไปแล้ว' } }, 409)).toBe(
      'สถานะข้อมูลเปลี่ยนไปแล้ว',
    )
  })

  it('falls back to the generic Thai message for 409 with no server message', () => {
    expect(readErrorMessage(null, 409)).toBe('ระบบทำรายการไม่สำเร็จ ลองใหม่อีกครั้งในอีกสักครู่')
  })

  it('falls back to the generic Thai message for 409 with a malformed error shape', () => {
    expect(readErrorMessage({ error: { message: 42 } }, 409)).toBe(
      'ระบบทำรายการไม่สำเร็จ ลองใหม่อีกครั้งในอีกสักครู่',
    )
  })

  it('falls back to the generic Thai message for 409 when json is not an object', () => {
    expect(readErrorMessage('unexpected string body', 409)).toBe(
      'ระบบทำรายการไม่สำเร็จ ลองใหม่อีกครั้งในอีกสักครู่',
    )
  })
})
