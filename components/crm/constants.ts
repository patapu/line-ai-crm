// OWNER: lane A
//
// Plain string literal tuples that mirror lib/contracts/crm.ts's zod enums,
// duplicated here so client components never bundle zod (they may only
// `import type` from modules/crm/* and the generated prisma client).

export const STAGES = ['NEW', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'] as const
export const SOURCES = ['WEBSITE', 'MANUAL', 'LINE'] as const
export const ACTIVITY_TYPES = ['NOTE', 'CALL', 'MEETING', 'EMAIL'] as const

export const STAGE_LABEL: Record<(typeof STAGES)[number], string> = {
  NEW: 'ใหม่',
  QUALIFIED: 'ผ่านคุณสมบัติ',
  PROPOSAL: 'เสนอราคา',
  WON: 'ปิดการขายสำเร็จ',
  LOST: 'ปิดการขายไม่สำเร็จ',
}

export const SOURCE_LABEL: Record<(typeof SOURCES)[number], string> = {
  WEBSITE: 'เว็บไซต์',
  MANUAL: 'กรอกเอง',
  LINE: 'LINE',
}

export const ACTIVITY_TYPE_LABEL: Record<(typeof ACTIVITY_TYPES)[number], string> = {
  NOTE: 'บันทึก',
  CALL: 'โทร',
  MEETING: 'นัดพบ',
  EMAIL: 'อีเมล',
}
