import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  MAX_DRAFT_CHARS,
  clampScore,
  normalizeDigits,
  extractFigures,
  collectAllowedFigures,
  findDraftViolations,
} from '@/modules/copilot/guardrails'
import type { LeadContext } from '@/modules/copilot/types'

// [B] modules/copilot/guardrails.test.ts (G1). Pure functions, no DB, no
// network. See docs/design.md section 4 and S4-plan.md section G1.

function makeCtx(overrides: Partial<LeadContext> = {}): LeadContext {
  return {
    lead: {
      id: 'clead00000000000000000001',
      title: 'Website inquiry',
      stage: 'QUALIFIED',
      source: 'WEBSITE',
      value: null,
      currency: 'THB',
      stageChangedAt: '2026-09-01T00:00:00.000Z',
      createdAt: '2026-08-01T00:00:00.000Z',
      ownerName: 'Owner',
    },
    contact: {
      firstName: 'Nok',
      lastName: null,
      hasLine: true,
      companyName: null,
      tags: [],
    },
    recentMessages: [],
    recentActivities: [],
    now: '2026-09-15T00:00:00.000Z',
    replyLocale: 'th',
    ...overrides,
  }
}

function outbound(text: string, at = '2026-09-10T00:00:00.000Z'): LeadContext['recentMessages'][number] {
  return { at, direction: 'OUTBOUND', channel: 'LINE', text }
}

function inbound(text: string, at = '2026-09-12T00:00:00.000Z'): LeadContext['recentMessages'][number] {
  return { at, direction: 'INBOUND', channel: 'LINE', text }
}

describe('clampScore', () => {
  it.each([
    [-5, 0],
    [150, 100],
    [72.4, 72],
    [Number.NaN, 0],
    [0, 0],
    [100, 100],
  ])('clampScore(%p) -> %p', (input, expected) => {
    expect(clampScore(input)).toBe(expected)
  })
})

describe('normalizeDigits', () => {
  it('converts Thai digits to ASCII', () => {
    expect(normalizeDigits('๐๑๒๓๔๕๖๗๘๙')).toBe('0123456789')
  })

  it('leaves non-Thai-digit text untouched', () => {
    expect(normalizeDigits('081-234-5678')).toBe('081-234-5678')
  })
})

describe('findDraftViolations: URL', () => {
  it.each(['https://x.co', 'www.example.com', 'line.me/R/ti/p/@abc', 'lin.ee/xYz', 'bit.ly/a'])(
    'flags %s as URL',
    (url) => {
      const ctx = makeCtx()
      expect(findDraftViolations(`ดูรายละเอียดที่ ${url} นะคะ`, ctx)).toContain('URL')
    },
  )
})

describe('findDraftViolations: EMAIL', () => {
  it('flags an email as EMAIL only, not URL', () => {
    const ctx = makeCtx()
    const violations = findDraftViolations('ติดต่อ a.b@example.co.th ได้เลยค่ะ', ctx)
    expect(violations).toContain('EMAIL')
    expect(violations).not.toContain('URL')
  })
})

describe('findDraftViolations: PHONE', () => {
  it.each(['081-234-5678', '02 123 4567', '+66 81 234 5678', '๐๘๑๒๓๔๕๖๗๘'])('flags %s as PHONE', (phone) => {
    const ctx = makeCtx()
    expect(findDraftViolations(`โทรมาที่ ${phone} นะคะ`, ctx)).toContain('PHONE')
  })
})

// n3 (S21 NIT n3): renamed from "does not flag %s" and '3.5' moved out. The
// old title/list implied '3.5' was fully unflagged, but it IS flagged as
// UNLISTED_PRICE (see "flags the bare decimal '3.5' as UNLISTED_PRICE (silent
// flip, S17 flipped_tests)" below) — this describe only ever asserted the
// absence of URL/EMAIL/PHONE, never UNLISTED_PRICE/PERCENT, so the assertions
// were never wrong, only the title/grouping was misleading.
describe('findDraftViolations: allowed non-figures (URL/EMAIL/PHONE only)', () => {
  it.each(['Example Trading Co., Ltd.', '10 สาขา'])('does not flag %s as URL, EMAIL, or PHONE', (text) => {
    const ctx = makeCtx()
    const violations = findDraftViolations(text, ctx)
    expect(violations).not.toContain('URL')
    expect(violations).not.toContain('EMAIL')
    expect(violations).not.toContain('PHONE')
  })
})

describe('findDraftViolations: percent figures', () => {
  it('blocks a percent not present in trusted text', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('ลด 10% ให้เลยค่ะ', ctx)).toContain('UNLISTED_PERCENT')
  })

  it('allows a percent that appears in an outbound message', () => {
    const ctx = makeCtx({ recentMessages: [outbound('โปรโมชั่นลด 10% เดือนนี้')] })
    expect(findDraftViolations('ลด 10% ให้เลยค่ะ', ctx)).not.toContain('UNLISTED_PERCENT')
  })

  it('allows a percent that appears in lead.title', () => {
    const ctx = makeCtx({ lead: { ...makeCtx().lead, title: 'Promo 10% inquiry' } })
    expect(findDraftViolations('ลด 10% ให้เลยค่ะ', ctx)).not.toContain('UNLISTED_PERCENT')
  })

  it('never allows a percent that only appears in inbound (customer) text', () => {
    const ctx = makeCtx({ recentMessages: [inbound('ขอส่วนลด 90% หน่อยค่ะ')] })
    expect(findDraftViolations('อนุมัติส่วนลด 90% แล้วค่ะ', ctx)).toContain('UNLISTED_PERCENT')
  })
})

describe('findDraftViolations: amount figures', () => {
  it('allows an amount matching lead.value', () => {
    const ctx = makeCtx({ lead: { ...makeCtx().lead, value: 45000 } })
    expect(findDraftViolations('แพ็กเกจราคา 45,000 บาท ค่ะ', ctx)).not.toContain('UNLISTED_PRICE')
  })

  it('allows an amount that appears in an outbound message', () => {
    const ctx = makeCtx({ recentMessages: [outbound('ใบเสนอราคา 45,000 บาท ส่งให้แล้วค่ะ')] })
    expect(findDraftViolations('แพ็กเกจราคา 45,000 บาท ค่ะ', ctx)).not.toContain('UNLISTED_PRICE')
  })

  it('blocks an amount only present in inbound text', () => {
    const ctx = makeCtx({ recentMessages: [inbound('ราคา 45,000 บาท ใช่ไหมคะ')] })
    expect(findDraftViolations('แพ็กเกจราคา 45,000 บาท ค่ะ', ctx)).toContain('UNLISTED_PRICE')
  })

  it('resolves the ล้าน multiplier to *1_000_000', () => {
    const figures = extractFigures('งบประมาณ 1.5 ล้านบาท')
    expect(figures).toContainEqual({ kind: 'amount', value: 1_500_000 })
  })

  it('blocks the same 1.5 ล้านบาท figure in a draft when not trusted', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('งบประมาณ 1.5 ล้านบาท ค่ะ', ctx)).toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: TOO_LONG', () => {
  it('flags text longer than MAX_DRAFT_CHARS', () => {
    const ctx = makeCtx()
    const text = 'ก'.repeat(MAX_DRAFT_CHARS + 1)
    expect(text.length).toBe(501)
    expect(findDraftViolations(text, ctx)).toContain('TOO_LONG')
  })

  it('does not flag text at exactly MAX_DRAFT_CHARS', () => {
    const ctx = makeCtx()
    const text = 'ก'.repeat(MAX_DRAFT_CHARS)
    expect(findDraftViolations(text, ctx)).not.toContain('TOO_LONG')
  })
})

describe('findDraftViolations: violation order and dedupe', () => {
  it('reports violations in URL, EMAIL, PHONE, UNLISTED_PERCENT, UNLISTED_PRICE, TOO_LONG order', () => {
    const ctx = makeCtx()
    const text = `${'ก'.repeat(MAX_DRAFT_CHARS + 1)} ลด 10% ราคา 999 บาท โทร 081-234-5678 อีเมล a@b.com เว็บ www.example.com`
    const violations = findDraftViolations(text, ctx)
    expect(violations).toEqual(['URL', 'EMAIL', 'PHONE', 'UNLISTED_PERCENT', 'UNLISTED_PRICE', 'TOO_LONG'])
  })

  it('deduplicates repeated violations of the same kind', () => {
    const ctx = makeCtx()
    const violations = findDraftViolations('โทร 081-234-5678 หรือ 02 123 4567 ก็ได้ค่ะ', ctx)
    expect(violations.filter((v) => v === 'PHONE')).toHaveLength(1)
  })
})

describe('collectAllowedFigures', () => {
  it('never trusts INBOUND message text', () => {
    const ctx = makeCtx({ recentMessages: [inbound('ส่วนลด 90% ลดราคา 999 บาท')] })
    const allowed = collectAllowedFigures(ctx)
    expect(allowed.percents).not.toContain(90)
  })

  it('includes lead.value in allowed amounts when not null', () => {
    const ctx = makeCtx({ lead: { ...makeCtx().lead, value: 45000 } })
    expect(collectAllowedFigures(ctx).amounts).toContain(45000)
  })

  it('does not include lead.value in allowed amounts when null', () => {
    const ctx = makeCtx({ lead: { ...makeCtx().lead, value: null } })
    expect(collectAllowedFigures(ctx).amounts).toEqual([])
  })
})

describe('collectAllowedFigures: trusted vs untrusted activity types', () => {
  const trustedTypes = ['NOTE', 'CALL', 'MEETING', 'EMAIL', 'MESSAGE_SENT'] as const
  const untrustedTypes = ['LEAD_CREATED', 'STAGE_CHANGED', 'OWNER_CHANGED', 'CONTACT_CREATED_FROM_LINE'] as const

  it.each(trustedTypes)('trusts a figure inside a %s activity', (type) => {
    const ctx = makeCtx({
      recentActivities: [{ at: '2026-09-10T00:00:00.000Z', type, text: 'ราคา 45,000 บาท' }],
    })
    expect(collectAllowedFigures(ctx).amounts).toContain(45000)
  })

  it.each(untrustedTypes)('does not trust a figure inside a %s activity', (type) => {
    const ctx = makeCtx({
      recentActivities: [{ at: '2026-09-10T00:00:00.000Z', type, text: 'ราคา 45,000 บาท' }],
    })
    expect(collectAllowedFigures(ctx).amounts).not.toContain(45000)
  })

  it('a figure trusted via an activity type still blocks the same draft figure when the activity type is untrusted', () => {
    const trustedCtx = makeCtx({
      recentActivities: [{ at: '2026-09-10T00:00:00.000Z', type: 'NOTE', text: 'ราคา 45,000 บาท ตามที่คุยกัน' }],
    })
    expect(findDraftViolations('แพ็กเกจราคา 45,000 บาท ค่ะ', trustedCtx)).not.toContain('UNLISTED_PRICE')

    const untrustedCtx = makeCtx({
      recentActivities: [
        { at: '2026-09-10T00:00:00.000Z', type: 'CONTACT_CREATED_FROM_LINE', text: 'ราคา 45,000 บาท ตามที่คุยกัน' },
      ],
    })
    expect(findDraftViolations('แพ็กเกจราคา 45,000 บาท ค่ะ', untrustedCtx)).toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: false positives (S11 fix pass 1)', () => {
  it.each([
    'จะแจ้งราคาให้ภายใน 2 วันค่ะ',
    'confirm the price within 2 days',
    'ได้ผลดีใน 3 เดือน',
    'our offer 2 options',
  ])('does not flag %s as UNLISTED_PRICE or UNLISTED_PERCENT', (text) => {
    const ctx = makeCtx()
    const violations = findDraftViolations(text, ctx)
    expect(violations).not.toContain('UNLISTED_PRICE')
    expect(violations).not.toContain('UNLISTED_PERCENT')
  })

  // flipped by design under option C (S16): '45,000,000' is a bare number with
  // no unit, date/time format, or trusted match, so flag-by-default now flags
  // it. (S17 flipped_tests F1; other rows in this describe stay clean.)
  it('flags "45,000,000" as UNLISTED_PRICE (flipped by design under option C, S16)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('45,000,000', ctx)).toContain('UNLISTED_PRICE')
  })

  // A bare date has 8 digits (2,0,2,6,0,9,1,5), one short of PHONE_CANDIDATE_RE's
  // 9-digit floor, so the phone check does not fire on it either. Documenting
  // the actual behavior here (rather than asserting nothing at all) so a
  // future change to the digit-count floor that starts flagging dates is
  // caught by this test, per the plan's acceptance of date-time false
  // positives as a known, non-blocking gap.
  it('does not flag a bare ISO date as PHONE (8 digits is under the 9-digit floor)', () => {
    const ctx = makeCtx()
    const violations = findDraftViolations('2026-09-15', ctx)
    expect(violations).not.toContain('PHONE')
  })
})

describe('findDraftViolations: true positives still fire (S11 fix pass 1 regression)', () => {
  it('flags ราคา 45,000 บาท as UNLISTED_PRICE', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('ราคา 45,000 บาท', ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags ส่วนลด 10% as UNLISTED_PERCENT', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('ส่วนลด 10%', ctx)).toContain('UNLISTED_PERCENT')
  })

  it('flags ลด 5,000 บาท as UNLISTED_PRICE', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('ลด 5,000 บาท', ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags price 9,900 as UNLISTED_PRICE', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('price 9,900', ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags 20% off as UNLISTED_PERCENT', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('20% off', ctx)).toContain('UNLISTED_PERCENT')
  })

  it('flags a bare per-month price เริ่มต้นที่ 9,900 ต่อเดือนค่ะ as UNLISTED_PRICE', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('เริ่มต้นที่ 9,900 ต่อเดือนค่ะ', ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags a bare per-month price 9,900/month as UNLISTED_PRICE', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('9,900/month', ctx)).toContain('UNLISTED_PRICE')
  })

  // "today" is not a time/count unit word (it is not in EN_UNIT_WORDS at
  // all), so the not-unit lookahead never suppresses this amount: a price
  // word followed by an amount immediately followed by an English date word
  // must still fire, unlike "price 9,900 days" (S12 MAJOR 1 unit matrix).
  it('flags "price 9,900 today" as UNLISTED_PRICE (a date word is not a unit word)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('price 9,900 today', ctx)).toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: unit lookahead backtracking false positives (S12 MAJOR 1)', () => {
  it.each([
    'จะแจ้งราคาให้ภายใน 15 วันค่ะ',
    'confirm the price within 24 hours',
    'ราคาจะยืนยันใน 12 เดือน',
    'แจ้งราคาภายใน 30 วัน',
    'ราคาจะแจ้งใน 2.5 วัน',
  ])('does not flag %s as UNLISTED_PRICE', (text) => {
    const ctx = makeCtx()
    expect(findDraftViolations(text, ctx)).not.toContain('UNLISTED_PRICE')
  })

  // T4 (S18): comment corrected, the old NOT_UNIT_LOOKAHEAD-backtracking
  // explanation no longer describes the matcher. Under the flag-by-default
  // grammar (S17 section 2), "business"/"working"/"calendar" + day(s) is a
  // first-class EN_UNITS alternative (`(?:business|working|calendar)[
  //  ]days?`), so a qualified day count is unit-exempt (E1) the same as
  // a plain "N days", independent of any surrounding price/discount word.
  it.each(['confirm the price within 5 business days', 'price confirmed in 3 working days'])(
    'does not flag %s as UNLISTED_PRICE',
    (text) => {
      const ctx = makeCtx()
      expect(findDraftViolations(text, ctx)).not.toContain('UNLISTED_PRICE')
    },
  )

  // A thousands-separated number ("1,000") immediately followed by a unit
  // word is the same "turnaround time near a price word" case as a plain
  // 2/3-digit number per SKILL.md's UNLISTED_PRICE section: the unit
  // lookahead applies to the whole NUM alternation, comma-grouped numbers
  // included, so this must stay unflagged same as "15 วัน"/"120 เดือน" above.
  it('does not flag a thousands-separated count followed by a unit word ("ราคาจะแจ้งใน 1,000 วัน")', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('ราคาจะแจ้งใน 1,000 วัน', ctx)).not.toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: unit-word matrix, 2-digit/3-digit/decimal per unit (S12 MAJOR 1)', () => {
  const THAI_UNITS = ['วันทำการ', 'วัน', 'ชั่วโมง', 'นาที', 'สัปดาห์', 'เดือน', 'ปี', 'สาขา', 'คน', 'ครั้ง']
  const EN_UNITS = ['days', 'hours', 'weeks', 'months', 'years', 'branches', 'people', 'times', 'options']
  const SAMPLES: Array<[string, string]> = [
    ['15', '2-digit'],
    ['120', '3-digit'],
    ['2.5', 'decimal'],
  ]

  for (const unit of THAI_UNITS) {
    for (const [num, label] of SAMPLES) {
      it(`does not flag "ราคาภายใน ${num} ${unit}ค่ะ" as UNLISTED_PRICE (${label} Thai unit ${unit})`, () => {
        const ctx = makeCtx()
        const text = `ราคาภายใน ${num} ${unit}ค่ะ`
        expect(findDraftViolations(text, ctx)).not.toContain('UNLISTED_PRICE')
      })
    }
  }

  for (const unit of EN_UNITS) {
    for (const [num, label] of SAMPLES) {
      it(`does not flag "confirm the price within ${num} ${unit}" as UNLISTED_PRICE (${label} English unit ${unit})`, () => {
        const ctx = makeCtx()
        const text = `confirm the price within ${num} ${unit}`
        expect(findDraftViolations(text, ctx)).not.toContain('UNLISTED_PRICE')
      })
    }
  }
})

describe('findDraftViolations: glued Thai discount trigger words (S12 MAJOR 2)', () => {
  it.each(['รับส่วนลด 500', 'ขอเสนอส่วนลด 2,000', 'ทางเราลดให้ 3,000 ค่ะ'])(
    'flags %s as UNLISTED_PRICE',
    (text) => {
      const ctx = makeCtx()
      expect(findDraftViolations(text, ctx)).toContain('UNLISTED_PRICE')
    },
  )
})

describe('findDraftViolations: additional unlisted amount true positives (S12)', () => {
  it.each(['ราคาพิเศษ 9,900 เดือนนี้', 'ลดให้ 500 วันนี้'])('flags %s as UNLISTED_PRICE', (text) => {
    const ctx = makeCtx()
    expect(findDraftViolations(text, ctx)).toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: price/cost/discount word inflections (S12 MINOR)', () => {
  it.each([
    ['Our prices start at 9,900', 'prices'],
    ['The item is priced at 4,500', 'priced'],
    ['Pricing starts at 3,000', 'pricing'],
    ['The Pro plan costs 4,500', 'costs'],
    ['Enjoy discounts of 2,000', 'discounts'],
    ['discounted to 5,000', 'discounted'],
  ])('flags "%s" as UNLISTED_PRICE (%s)', (text) => {
    const ctx = makeCtx()
    expect(findDraftViolations(text, ctx)).toContain('UNLISTED_PRICE')
  })
})

// flipped by design under option C (S16): these rows used to stay unflagged
// because the old matcher only fired near a price/discount trigger word.
// Flag-by-default has no such trigger-word gate, so a bare untrusted number
// is flagged regardless of the Thai word it happens to sit next to (S17
// flipped_tests F2). Renamed from "... stay unflagged ..." accordingly.
describe('findDraftViolations: glued ลด non-trigger words now flag as bare numbers (flipped by design under option C, S16)', () => {
  it.each(['โหลด 500', 'ดาวน์โหลด 1,200', 'ผลดี 300', 'ปลด 10'])(
    'flags %s as UNLISTED_PRICE',
    (text) => {
      const ctx = makeCtx()
      expect(findDraftViolations(text, ctx)).toContain('UNLISTED_PRICE')
    },
  )
})

describe('findDraftViolations / extractFigures: ReDoS guard (S18, T6, worst-case 20k-char inputs)', () => {
  // S17 T6's worst-case inputs, each ~20,000 chars: pathological runs of
  // digit/separator combinations chosen to stress the sticky/lookaround
  // checks (trailing commas, trailing dots, a Thai unit prefix repeated,
  // a dash-joined run ending in a real range+unit, colon-separated runs
  // that look like times, and a trailing non-digit "x").
  const WORST_CASE_INPUTS: Array<[string, string]> = [
    ["'1,'.repeat(10000)", '1,'.repeat(10_000)],
    ["'1.'.repeat(10000)", '1.'.repeat(10_000)],
    ["'1 วั'.repeat(5000)", '1 วั'.repeat(5_000)],
    ["'1-'.repeat(10000)+'1 วัน'", '1-'.repeat(10_000) + '1 วัน'],
    ["'1:0'.repeat(6700)", '1:0'.repeat(6_700)],
    ["'1 '.repeat(10000)+'x'", '1 '.repeat(10_000) + 'x'],
  ]

  const BUDGET_MS = 250
  const RUNS = 3

  /** Minimum wall-clock time across RUNS calls, to avoid a single slow/GC'd run causing a flaky failure. */
  function minDuration(fn: () => void): number {
    let best = Infinity
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now()
      fn()
      const duration = performance.now() - start
      if (duration < best) best = duration
    }
    return best
  }

  it.each(WORST_CASE_INPUTS)('extractFigures resolves in under 250ms budget (min of 3 runs) for %s', (label, input) => {
    expect(minDuration(() => extractFigures(input))).toBeLessThan(BUDGET_MS)
  })

  it.each(WORST_CASE_INPUTS)(
    'findDraftViolations resolves in under 250ms budget (min of 3 runs) for %s, proving the SCAN_LIMIT cap',
    (label, input) => {
      const ctx = makeCtx()
      expect(minDuration(() => findDraftViolations(input, ctx))).toBeLessThan(BUDGET_MS)
    },
  )

  // m5 (S21 MINOR m5): additional worst-case inputs shaped to stress
  // EMAIL_RE/URL_RE's character-class-then-literal backtracking (a long run
  // with no terminating '@'/TLD at all, and a long run of '@' signs that look
  // email-like). findDraftViolations should stay inside budget regardless,
  // since SCAN_LIMIT truncates `s` before any of EMAIL_RE/URL_RE/PHONE_RE run.
  const FIND_DRAFT_ONLY_WORST_CASE_INPUTS: Array<[string, string]> = [
    ["'a-'.repeat(10000)", 'a-'.repeat(10_000)],
    ["'a'.repeat(20000)", 'a'.repeat(20_000)],
    ["'a@'.repeat(5000)", 'a@'.repeat(5_000)],
  ]

  it.each(FIND_DRAFT_ONLY_WORST_CASE_INPUTS)(
    'findDraftViolations resolves in under 250ms budget (min of 3 runs) for %s (S21 m5)',
    (label, input) => {
      const ctx = makeCtx()
      expect(minDuration(() => findDraftViolations(input, ctx))).toBeLessThan(BUDGET_MS)
    },
  )
})

// ---------------------------------------------------------------------------
// S18 (T-20260915-001 rev 3): flag-by-default matcher tests added per
// S17-design.md sections 1, 2, 5, 6 (option C, S16). These describe the
// NOT-YET-IMPLEMENTED matcher (S19 implements guardrails.ts sections 1-4);
// every test below is expected to be RED against the current guardrails.ts.
// ---------------------------------------------------------------------------

describe('findDraftViolations: option C new expectations (S17 section 5)', () => {
  it("flags a phone number as exactly ['PHONE'], with no bare-digit UNLISTED_PRICE noise", () => {
    const ctx = makeCtx()
    expect(findDraftViolations('โทร 081-234-5678', ctx)).toEqual(['PHONE'])
  })

  it('flags both the range-start number and the percent in "10-20%" (E2 never joins into a percent token)', () => {
    const ctx = makeCtx()
    const violations = findDraftViolations('10-20%', ctx)
    expect(violations).toContain('UNLISTED_PERCENT')
    expect(violations).toContain('UNLISTED_PRICE')
  })

  it('flags "15/9" (no year) as UNLISTED_PRICE: not a valid numeric-date span without a year group', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('15/9', ctx)).toContain('UNLISTED_PRICE')
  })

  it('does not flag "15/9/2569" (day/month/year numeric date, E3)', () => {
    const ctx = makeCtx()
    const violations = findDraftViolations('15/9/2569', ctx)
    expect(violations).not.toContain('UNLISTED_PRICE')
    expect(violations).not.toContain('UNLISTED_PERCENT')
  })

  it('flags "ปี 2000 บาท": ปี and บาท are neither units nor currency-before, so 2000 is a bare number', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('ปี 2000 บาท', ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags the spelled-out amount "ห้าพันบาท" (R2 spelled-money)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('ห้าพันบาท', ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags the spelled-out percent "สิบเปอร์เซ็นต์" (R2 spelled-money, percent suffix)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('สิบเปอร์เซ็นต์', ctx)).toContain('UNLISTED_PERCENT')
  })

  it('does not flag "1.5 ล้านบาท" when 1,500,000 is trusted via lead.value', () => {
    const ctx = makeCtx({ lead: { ...makeCtx().lead, value: 1_500_000 } })
    expect(findDraftViolations('งบประมาณ 1.5 ล้านบาท ค่ะ', ctx)).not.toContain('UNLISTED_PRICE')
  })

  it('flags "ราคา 9,900 เดือนที่แล้ว": ที่แล้ว is a special-cased continuation only after วัน, not เดือน', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('ราคา 9,900 เดือนที่แล้ว', ctx)).toContain('UNLISTED_PRICE')
  })

  it('does not flag "500 รายการ" (รายการ is an approved TH unit, end-of-draft continuation)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('500 รายการ', ctx)).not.toContain('UNLISTED_PRICE')
  })

  it('does not flag "ราคาปรับเมื่อ 3 วันที่แล้ว" (ที่แล้ว after วัน is an approved exemption)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('ราคาปรับเมื่อ 3 วันที่แล้ว', ctx)).not.toContain('UNLISTED_PRICE')
  })

  // Silent flip (S17 flipped_tests): '3.5' used to be listed as an "allowed
  // non-figure" only because no AMOUNT_*/PRICE_WORD/DISCOUNT_WORD regex ever
  // matched a bare decimal with no trigger word nearby. Flag-by-default scans
  // every plain number, so a bare untrusted decimal now flags too.
  it("flags the bare decimal '3.5' as UNLISTED_PRICE (silent flip, S17 flipped_tests)", () => {
    const ctx = makeCtx()
    expect(findDraftViolations('3.5', ctx)).toContain('UNLISTED_PRICE')
  })

  it("'2026-09-15' is clean for a new reason: it is an exempt ISO-date span now, not merely under PHONE's 9-digit floor", () => {
    const ctx = makeCtx()
    const violations = findDraftViolations('2026-09-15', ctx)
    expect(violations).not.toContain('UNLISTED_PRICE')
    expect(violations).not.toContain('PHONE')
  })
})

describe('findDraftViolations: trusted-figure normalization (S17 section 4)', () => {
  it.each(['45,000', '45000', '45k', '4.5 หมื่น', '45 พัน'])(
    'allows the draft figure "%s" when 45000 is trusted via lead.value',
    (text) => {
      const ctx = makeCtx({ lead: { ...makeCtx().lead, value: 45_000 } })
      expect(findDraftViolations(text, ctx)).not.toContain('UNLISTED_PRICE')
    },
  )

  it('a trusted 10% does not allow a bare untrusted 10 (percents and amounts are separate allow-lists)', () => {
    const ctx = makeCtx({ recentMessages: [outbound('โปรโมชั่นลด 10% เดือนนี้')] })
    expect(findDraftViolations('10', ctx)).toContain('UNLISTED_PRICE')
  })

  it('a trusted 1.5 ล้าน does not allow a bare untrusted 1.5 (trusted 1,500,000 does not license the raw multiplicand)', () => {
    const ctx = makeCtx({ recentMessages: [outbound('งบประมาณ 1.5 ล้านบาท')] })
    expect(findDraftViolations('1.5', ctx)).toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: must-flag table, verbatim true positives (S17 section 5 pass-3 MUST FLAG list + earlier true positives)', () => {
  it.each([
    ['ราคา 45,000 บาท', 'UNLISTED_PRICE'],
    ['ส่วนลด 10%', 'UNLISTED_PERCENT'],
    ['ลด 5,000 บาท', 'UNLISTED_PRICE'],
    ['price 9,900', 'UNLISTED_PRICE'],
    ['20% off', 'UNLISTED_PERCENT'],
    ['1.5 ล้านบาท', 'UNLISTED_PRICE'],
    ['฿9,900', 'UNLISTED_PRICE'],
    ['9,900 ต่อเดือน', 'UNLISTED_PRICE'],
    ['9,900/month', 'UNLISTED_PRICE'],
    ['เดือนละ 9,900', 'UNLISTED_PRICE'],
    ['Our prices start at 9,900', 'UNLISTED_PRICE'],
    ['costs 4,500', 'UNLISTED_PRICE'],
    ['discounted to 5,000', 'UNLISTED_PRICE'],
    ['ราคาพิเศษ 9,900 สัปดาห์นี้', 'UNLISTED_PRICE'],
    ['ลดให้ 1,000 ครั้งนี้เท่านั้น', 'UNLISTED_PRICE'],
    ['ส่วนลด 500 ครั้งแรก', 'UNLISTED_PRICE'],
    ['ราคา 9,900 เดือนหน้า', 'UNLISTED_PRICE'],
    ['ลด 500 วันจันทร์นี้', 'UNLISTED_PRICE'],
    ['ราคา 9,900 สาขานี้', 'UNLISTED_PRICE'],
    ['ทางเราลด 3,000 ให้ค่ะ', 'UNLISTED_PRICE'],
    ['ขอลด 500 ให้นะคะ', 'UNLISTED_PRICE'],
    ['จะลด 1,000 ให้ค่ะ', 'UNLISTED_PRICE'],
    ['ร้านลด 2,000', 'UNLISTED_PRICE'],
    ['ระบบดาวน์โหลดให้ได้ 500', 'UNLISTED_PRICE'],
  ] as const)('flags "%s" as %s when the same figure is not present in trusted text', (text, code) => {
    const ctx = makeCtx()
    expect(findDraftViolations(text, ctx)).toContain(code)
  })
})

describe('findDraftViolations: T3 unit matrix, positive (S17 section 2, S18 T3 fix)', () => {
  const TH_UNITS_S17 = [
    'วันทำการ',
    'วัน',
    'คืน',
    'ชั่วโมง',
    'ชม.',
    'นาที',
    'วินาที',
    'สัปดาห์',
    'อาทิตย์',
    'เดือน',
    'ปี',
    'คน',
    'ท่าน',
    'ครั้ง',
    'ชิ้น',
    'สาขา',
    'รายการ',
    'ขั้นตอน',
    'ข้อความ',
    'ข้อ',
    'ตัวเลือก',
    'ที่นั่ง',
    'เครื่อง',
    'ผู้ใช้',
  ]
  const TH_DISALLOWED_CONTINUATIONS = ['นี้', 'หน้า', 'แรก', 'จันทร์', 'ละ']
  const thMatrix: Array<[string, string]> = TH_UNITS_S17.flatMap((unit) =>
    TH_DISALLOWED_CONTINUATIONS.map((cont): [string, string] => [unit, cont]),
  )

  it.each(thMatrix)('flags "500 %s%s" as UNLISTED_PRICE (every TH unit x disallowed continuation)', (unit, cont) => {
    const ctx = makeCtx()
    expect(findDraftViolations(`500 ${unit}${cont}`, ctx)).toContain('UNLISTED_PRICE')
  })

  const EN_UNITS_S17 = [
    'days',
    'nights',
    'hours',
    'hrs',
    'minutes',
    'mins',
    'seconds',
    'secs',
    'weeks',
    'months',
    'years',
    'yrs',
    'people',
    'persons',
    'times',
    'branches',
    'items',
    'steps',
    'options',
    'seats',
    'users',
    'locations',
  ]

  it.each(EN_UNITS_S17)('flags "$3 %s" as UNLISTED_PRICE (currency-before is never exempt, even right before a unit)', (unit) => {
    const ctx = makeCtx()
    expect(findDraftViolations(`$3 ${unit}`, ctx)).toContain('UNLISTED_PRICE')
  })

  it.each(EN_UNITS_S17)('flags "3k %s" as UNLISTED_PRICE (a multiplier is never exempt, even right before a unit)', (unit) => {
    const ctx = makeCtx()
    expect(findDraftViolations(`3k ${unit}`, ctx)).toContain('UNLISTED_PRICE')
  })

  it.each(EN_UNITS_S17)('flags "3% %s" as UNLISTED_PERCENT (a percent is never exempt, even right before a unit)', (unit) => {
    const ctx = makeCtx()
    expect(findDraftViolations(`3% ${unit}`, ctx)).toContain('UNLISTED_PERCENT')
  })

  it.each(EN_UNITS_S17)('flags "3 %sx" as UNLISTED_PRICE (a glued trailing letter breaks the EN unit boundary)', (unit) => {
    const ctx = makeCtx()
    expect(findDraftViolations(`3 ${unit}x`, ctx)).toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: must-pass table, approved exemptions only (S17 section 2, S18)', () => {
  const CONTINUATION_PARTICLES = [
    'ค่ะ',
    'คะ',
    'ครับ',
    'นะ',
    'นะคะ',
    'นะครับ',
    'จ้ะ',
    'จ้า',
    'และ',
    'หรือ',
    'ให้',
    'จะ',
    'ครึ่ง',
  ]

  it.each(CONTINUATION_PARTICLES)('does not flag "จะเสร็จใน 3 วัน%s" (approved continuation particle)', (particle) => {
    const ctx = makeCtx()
    expect(findDraftViolations(`จะเสร็จใน 3 วัน${particle}`, ctx)).not.toContain('UNLISTED_PRICE')
  })

  const PUNCTUATION = ['.', ',', '!', '?', ';', ':', ')', ']', '"', "'", '”', '’', '…']

  it.each(PUNCTUATION)('does not flag "จะเสร็จใน 3 วัน%s" (approved punctuation continuation)', (punct) => {
    const ctx = makeCtx()
    expect(findDraftViolations(`จะเสร็จใน 3 วัน${punct}`, ctx)).not.toContain('UNLISTED_PRICE')
  })

  it('does not flag a unit followed by whitespace then more text', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('จะเสร็จใน 3 วัน แล้วแจ้งนะคะ', ctx)).not.toContain('UNLISTED_PRICE')
  })

  it('does not flag a unit at the very end of the draft', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('จะเสร็จใน 3 วัน', ctx)).not.toContain('UNLISTED_PRICE')
  })

  const TH_UNITS_END = [
    'วันทำการ',
    'วัน',
    'คืน',
    'ชั่วโมง',
    'ชม.',
    'นาที',
    'วินาที',
    'สัปดาห์',
    'อาทิตย์',
    'เดือน',
    'ปี',
    'คน',
    'ท่าน',
    'ครั้ง',
    'ชิ้น',
    'สาขา',
    'รายการ',
    'ขั้นตอน',
    'ข้อความ',
    'ข้อ',
    'ตัวเลือก',
    'ที่นั่ง',
    'เครื่อง',
    'ผู้ใช้',
  ]

  it.each(TH_UNITS_END)('does not flag "3 %s" at end-of-draft (every approved TH unit)', (unit) => {
    const ctx = makeCtx()
    expect(findDraftViolations(`3 ${unit}`, ctx)).not.toContain('UNLISTED_PRICE')
  })

  const EN_UNITS_END = [
    'days',
    'nights',
    'hours',
    'hrs',
    'minutes',
    'mins',
    'seconds',
    'secs',
    'weeks',
    'months',
    'years',
    'yrs',
    'people',
    'persons',
    'times',
    'branches',
    'items',
    'steps',
    'options',
    'seats',
    'users',
    'locations',
  ]

  it.each(EN_UNITS_END)('does not flag "3 %s" at end-of-draft (every approved EN unit)', (unit) => {
    const ctx = makeCtx()
    expect(findDraftViolations(`3 ${unit}`, ctx)).not.toContain('UNLISTED_PRICE')
  })

  it.each([
    ['15', 'วัน'],
    ['120', 'เดือน'],
    ['2.5', 'ชั่วโมง'],
    ['1,000', 'วัน'],
  ] as const)('does not flag "%s %s" (2-digit/3-digit/decimal/thousands samples)', (num, unit) => {
    const ctx = makeCtx()
    expect(findDraftViolations(`${num} ${unit}`, ctx)).not.toContain('UNLISTED_PRICE')
  })

  it.each(['1-2 วันทำการ', '2-3 days', '1 ~ 3 วัน'])('does not flag the range "%s" (E2)', (text) => {
    const ctx = makeCtx()
    expect(findDraftViolations(text, ctx)).not.toContain('UNLISTED_PRICE')
  })

  it('does not flag "3 วันที่แล้ว" (ที่แล้ว is a special-cased continuation, วัน only)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('3 วันที่แล้ว', ctx)).not.toContain('UNLISTED_PRICE')
  })

  it.each([
    ['2026-09-15', 'ISO date'],
    ['15/9/2569', 'numeric date with year'],
    ['วันที่ 15', 'วันที่ + day'],
    ['15 ก.ย.', 'day + Thai abbreviated month'],
    ['15 ก.ย. 2569', 'day + Thai month + พ.ศ. year'],
    ['September 15', 'EN month + day'],
    ['Sept 15, 2026', 'EN month + day + year'],
    ['พ.ศ. 2569', 'era + year'],
    ['15th', 'ordinal day'],
    ['10:00 น.', 'colon time with Thai suffix'],
    ['10:00', 'bare colon time, suffix is optional'],
    ['10.00 น.', 'dot time, suffix required'],
    ['3 โมงเย็น', 'Thai clock word โมงเย็น'],
    ['2 ทุ่ม', 'Thai clock word ทุ่ม'],
    ['ตี 3', 'ตี + hour'],
    ['บ่าย 2', 'บ่าย + hour'],
    ['10pm', 'English clock am/pm'],
    ["9 o'clock", "English clock o'clock"],
  ])('does not flag the date/time span "%s" (%s, E3)', (text) => {
    const ctx = makeCtx()
    const violations = findDraftViolations(text, ctx)
    expect(violations).not.toContain('UNLISTED_PRICE')
    expect(violations).not.toContain('UNLISTED_PERCENT')
  })

  it.each([
    ['32 ก.ย.', 'day 32 is out of range 1..31, not a real date span'],
    ['25:00', 'hour 25 is out of range 0..23, not a real time span'],
  ])('flags the invalid date/time-shaped text "%s" as UNLISTED_PRICE (%s)', (text) => {
    const ctx = makeCtx()
    expect(findDraftViolations(text, ctx)).toContain('UNLISTED_PRICE')
  })
})

// ---------------------------------------------------------------------------
// S20 (T-20260915-001 rev 3): additional coverage for S19 behavior that S18
// left untested where it was cheap and pure (see S17-design.md sections 1-2,
// R2, and section 8's residual limits).
// ---------------------------------------------------------------------------

describe('findDraftViolations: T3 unit matrix, positive, Thai units (S17 section 2; S18 only covered EN_UNITS_S17 for this)', () => {
  const TH_UNITS_SAMPLE = ['วัน', 'เดือน', 'ครั้ง']

  it.each(TH_UNITS_SAMPLE)('flags "฿3 %s" as UNLISTED_PRICE (currency-before is never exempt, even right before a Thai unit)', (unit) => {
    const ctx = makeCtx()
    expect(findDraftViolations(`฿3 ${unit}`, ctx)).toContain('UNLISTED_PRICE')
  })

  it.each(TH_UNITS_SAMPLE)('flags "3พัน %s" as UNLISTED_PRICE (a Thai multiplier is never exempt, even right before a Thai unit)', (unit) => {
    const ctx = makeCtx()
    expect(findDraftViolations(`3พัน ${unit}`, ctx)).toContain('UNLISTED_PRICE')
  })

  it.each(TH_UNITS_SAMPLE)('flags "3% %s" as UNLISTED_PERCENT (a percent is never exempt, even right before a Thai unit)', (unit) => {
    const ctx = makeCtx()
    expect(findDraftViolations(`3% ${unit}`, ctx)).toContain('UNLISTED_PERCENT')
  })
})

describe('findDraftViolations: R2 spelled-out money, English (S17 section 3; S18 only pinned the Thai R2 rows)', () => {
  it('flags the spelled-out amount "five thousand baht" (R2 spelled-money, English number word)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('five thousand baht', ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags the spelled-out percent "twenty percent" (R2 spelled-money, English percent word)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('twenty percent', ctx)).toContain('UNLISTED_PERCENT')
  })
})

describe('findDraftViolations: trusted order number written by the sales team (S17 section 4)', () => {
  it('allows an order number in the draft when the sales team already wrote it in an OUTBOUND message', () => {
    const ctx = makeCtx({ recentMessages: [outbound('เลขที่คำสั่งซื้อของคุณคือ 88412 ค่ะ')] })
    expect(findDraftViolations('คำสั่งซื้อเลขที่ 88412 กำลังจัดส่งค่ะ', ctx)).not.toContain('UNLISTED_PRICE')
  })

  it('still blocks the same order number when only the customer (INBOUND) wrote it', () => {
    const ctx = makeCtx({ recentMessages: [inbound('เลขที่คำสั่งซื้อของฉันคือ 88412')] })
    expect(findDraftViolations('คำสั่งซื้อเลขที่ 88412 กำลังจัดส่งค่ะ', ctx)).toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: E2 range with an en dash (S17 section 2; S18 only used hyphen and tilde samples)', () => {
  it('does not flag "2–3 วัน" (en dash range, both sides E1-exempt)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('2–3 วัน', ctx)).not.toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: known limit R1, see SKILL.md (promotion with no price figure)', () => {
  // known limit R1, see SKILL.md: a promotion with no price figure at all
  // (ฟรี 3 เดือน, ส่วนลด 2 เดือน, ครึ่งราคา) has nothing for the guard to flag;
  // this pins today's actual behavior (clean) as a documented limit, not a
  // requirement that it stay this way.
  it('does not flag "ฟรี 3 เดือน" today (known limit R1, see SKILL.md)', () => {
    const ctx = makeCtx()
    const violations = findDraftViolations('ฟรี 3 เดือน', ctx)
    expect(violations).not.toContain('UNLISTED_PRICE')
    expect(violations).not.toContain('UNLISTED_PERCENT')
  })
})

describe('extractFigures property: percent spans are never double-counted as amounts', () => {
  it('an amount overlapping a percent span never yields an amount figure with the same numeric value', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (n) => {
        const figures = extractFigures(`ลด ${n}% ค่ะ`)
        const amountSameValue = figures.some((f) => f.kind === 'amount' && f.value === n)
        expect(amountSameValue).toBe(false)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// S18 (T-20260915-001 rev 3, pass 4): RED tests for from_S21 pass-4 findings
// M1-M5 (MAJOR), m1-m3/m5 (MINOR), n1-n2 (NIT), against the current, not-yet
// fixed guardrails.ts. S19 fixes the matcher; these tests are expected to
// flip to GREEN there. n3 was addressed above (test renamed, '3.5' moved
// out). n4 (requireBody array-check) has no seam approved in S17-design.md
// section 6/T7 (which only covers key presence, not array shape), so no test
// is added for it here; see the S18 report for "verify by reading".
// ---------------------------------------------------------------------------

describe('findDraftViolations: M1 E2 range ignores neverExempt (S21 pass 4 MAJOR M1)', () => {
  it.each([
    ['$990 - 3 days', 'UNLISTED_PRICE'],
    ['THB 9,900 - 2 days', 'UNLISTED_PRICE'],
    ['฿990 – 3 วัน เท่านั้น', 'UNLISTED_PRICE'],
    ['ร้อยละ 10 - 3 วัน', 'UNLISTED_PERCENT'],
  ] as const)(
    'flags "%s" as %s (a never-exempt currency/percent token must not be swept into an E2 range via its E1-exempt neighbor)',
    (text, code) => {
      const ctx = makeCtx()
      expect(findDraftViolations(text, ctx)).toContain(code)
    },
  )
})

describe('findDraftViolations: M2 E2 accepts a descending range (S21 pass 4 MAJOR M2)', () => {
  it.each(['Special price 9,900 - 3 days only', 'ราคาพิเศษ 9,900 – 3 วัน เท่านั้นค่ะ', 'โปรพิเศษ 1,990 ~ 7 วันนะคะ'])(
    'flags %s as UNLISTED_PRICE (E2 must only join an ascending range; the left number is not a genuine range partner of the unit-exempt right number)',
    (text) => {
      const ctx = makeCtx()
      expect(findDraftViolations(text, ctx)).toContain('UNLISTED_PRICE')
    },
  )

  // Approved ascending ranges must stay clean. Already asserted by the
  // existing must-pass table above ('1-2 วันทำการ', '2-3 days', '1 ~ 3 วัน',
  // '2–3 วัน'); not repeated here, only referenced as the regression guard
  // for the M2 fix.
})

describe('normalizeDigits: M3 non-Thai Unicode digit and symbol normalization (S21 pass 4 MAJOR M3)', () => {
  const fullWidthDigits = String.fromCharCode(0xff10, 0xff11, 0xff12, 0xff13, 0xff14, 0xff15, 0xff16, 0xff17, 0xff18, 0xff19)
  const arabicIndicDigits = String.fromCharCode(0x0660, 0x0661, 0x0662, 0x0663, 0x0664, 0x0665, 0x0666, 0x0667, 0x0668, 0x0669)
  const extArabicIndicDigits = String.fromCharCode(0x06f0, 0x06f1, 0x06f2, 0x06f3, 0x06f4, 0x06f5, 0x06f6, 0x06f7, 0x06f8, 0x06f9)
  const fullWidthPercent = String.fromCharCode(0xff05)
  const fullWidthComma = String.fromCharCode(0xff0c)

  it('maps full-width digits U+FF10-FF19 to ASCII 0-9', () => {
    expect(normalizeDigits(fullWidthDigits)).toBe('0123456789')
  })

  it('maps Arabic-Indic digits U+0660-0669 to ASCII 0-9', () => {
    expect(normalizeDigits(arabicIndicDigits)).toBe('0123456789')
  })

  it('maps Extended Arabic-Indic (Persian) digits U+06F0-06F9 to ASCII 0-9', () => {
    expect(normalizeDigits(extArabicIndicDigits)).toBe('0123456789')
  })

  it('maps the full-width percent sign U+FF05 to "%"', () => {
    expect(normalizeDigits(`10${fullWidthPercent}`)).toBe('10%')
  })

  it('maps the full-width comma U+FF0C to ","', () => {
    expect(normalizeDigits(`9${fullWidthComma}900`)).toBe('9,900')
  })

  it('output length equals input length (1:1 code-unit mapping, no NFKC)', () => {
    const input = `${fullWidthDigits}${arabicIndicDigits}${extArabicIndicDigits}${fullWidthPercent}${fullWidthComma}`
    expect(normalizeDigits(input).length).toBe(input.length)
  })

  it('leaves Thai ำ untouched (no NFKC normalization folds it into anything else)', () => {
    expect(normalizeDigits('วันทำการ')).toBe('วันทำการ')
  })
})

describe('findDraftViolations: M3 non-Thai Unicode digits must reach the scanner (S21 pass 4 MAJOR M3)', () => {
  it('flags "ราคา ９,９００ บาท" (full-width digits, ASCII comma) as UNLISTED_PRICE', () => {
    const d9 = String.fromCharCode(0xff19)
    const d0 = String.fromCharCode(0xff10)
    const ctx = makeCtx()
    expect(findDraftViolations(`ราคา ${d9},${d9}${d0}${d0} บาท`, ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags "ลด １０％" (full-width digits and full-width percent) as UNLISTED_PERCENT', () => {
    const d1 = String.fromCharCode(0xff11)
    const d0 = String.fromCharCode(0xff10)
    const pct = String.fromCharCode(0xff05)
    const ctx = makeCtx()
    expect(findDraftViolations(`ลด ${d1}${d0}${pct}`, ctx)).toContain('UNLISTED_PERCENT')
  })

  it('flags Arabic-Indic digits "٩٩٠٠ บาท" (U+0660-0669) as UNLISTED_PRICE', () => {
    const d9 = String.fromCharCode(0x0669)
    const d0 = String.fromCharCode(0x0660)
    const ctx = makeCtx()
    expect(findDraftViolations(`${d9}${d9}${d0}${d0} บาท`, ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags Extended Arabic-Indic digits "۹۹۰۰ บาท" (U+06F0-06F9) as UNLISTED_PRICE', () => {
    const d9 = String.fromCharCode(0x06f9)
    const d0 = String.fromCharCode(0x06f0)
    const ctx = makeCtx()
    expect(findDraftViolations(`${d9}${d9}${d0}${d0} บาท`, ctx)).toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: M4 E3 reads the English modal "may" as the month May (S21 pass 4 MAJOR M4)', () => {
  it.each(['A fee of 20 may apply.', 'An extra 15 may be charged.'])(
    'flags "%s" as UNLISTED_PRICE (a bare "may" following a day-shaped number must not be treated as the month)',
    (text) => {
      const ctx = makeCtx()
      expect(findDraftViolations(text, ctx)).toContain('UNLISTED_PRICE')
    },
  )

  it.each(['May 20', '20 May', '20th May', 'May 20, 2026'])(
    'does not flag "%s" (a real date reference to the month May stays exempt, regression guard for the M4 fix)',
    (text) => {
      const ctx = makeCtx()
      const violations = findDraftViolations(text, ctx)
      expect(violations).not.toContain('UNLISTED_PRICE')
      expect(violations).not.toContain('UNLISTED_PERCENT')
    },
  )
})

describe('findDraftViolations: M5 E3 optional year swallows a 4-digit price (S21 pass 4 MAJOR M5)', () => {
  it.each(['โปรถึง 30 ก.ย. 1990 บาท', 'until Sept 30, 2090 baht'])(
    'flags "%s" as UNLISTED_PRICE (the optional year group swallows an out-of-era 4-digit price as if it were a year)',
    (text) => {
      const ctx = makeCtx()
      expect(findDraftViolations(text, ctx)).toContain('UNLISTED_PRICE')
    },
  )

  it('does not flag "30 ก.ย. 2569" (BE year within the planned current-era range, regression guard)', () => {
    const ctx = makeCtx()
    const violations = findDraftViolations('30 ก.ย. 2569', ctx)
    expect(violations).not.toContain('UNLISTED_PRICE')
    expect(violations).not.toContain('UNLISTED_PERCENT')
  })

  it('does not flag "15/9/2569" (numeric date with year, regression guard)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('15/9/2569', ctx)).not.toContain('UNLISTED_PRICE')
  })

  it('does not flag "2026-09-15" (ISO date, CE year within the planned current-era range, regression guard)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('2026-09-15', ctx)).not.toContain('UNLISTED_PRICE')
  })

  it('does not flag "15/9/2026" (numeric date with a 4-digit CE year, regression guard)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('15/9/2026', ctx)).not.toContain('UNLISTED_PRICE')
  })

  it('flags "15/9/1990" as UNLISTED_PRICE (1990 is out of the planned current-era range once the numeric-date pattern also range-checks its year, see n1)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('15/9/1990', ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags "30 ก.ย. 2590" as UNLISTED_PRICE (2590 BE is out of the planned narrower 2563..2578 range, treated as a bare number)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('30 ก.ย. 2590', ctx)).toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: m1 BOUNDARY_CHAR_RE invisible-whitespace bypass (S21 pass 4 MINOR m1)', () => {
  it.each([
    ['U+FEFF (BOM / zero-width no-break space)', 0xfeff],
    ['U+2009 (thin space)', 0x2009],
    ['U+202F (narrow no-break space)', 0x202f],
    ['U+3000 (ideographic space)', 0x3000],
  ] as const)(
    'flags "ราคา 9,900 เดือน<%s>หน้า" as UNLISTED_PRICE (an \\s-matching invisible-ish character must not stand in for a real boundary before a disallowed continuation word)',
    (label, code) => {
      const invisible = String.fromCharCode(code)
      const ctx = makeCtx()
      expect(findDraftViolations(`ราคา 9,900 เดือน${invisible}หน้า`, ctx)).toContain('UNLISTED_PRICE')
    },
  )

  it.each([
    ['U+200B (zero-width space)', 0x200b],
    ['U+2060 (word joiner)', 0x2060],
  ] as const)(
    'already correctly flags "ราคา 9,900 เดือน<%s>หน้า" (these do not match \\s, so continuationOk already returns false here)',
    (label, code) => {
      const invisible = String.fromCharCode(code)
      const ctx = makeCtx()
      expect(findDraftViolations(`ราคา 9,900 เดือน${invisible}หน้า`, ctx)).toContain('UNLISTED_PRICE')
    },
  )

  // known limit R1 (S17-design.md section 8): a plain ASCII space between the
  // unit and a disallowed continuation word is itself an approved boundary
  // character, so this exact "spaced modifier" shape passes today. Pinning
  // current behavior, not asserting it is correct.
  it('does not flag "9,900 เดือน หน้า" today (plain-space spaced modifier, known limit R1)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('9,900 เดือน หน้า', ctx)).not.toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: m2 percent spelling variants must be UNLISTED_PERCENT, not amounts (S21 pass 4 MINOR m2)', () => {
  it.each(['ลด 10 เปอร์เซนต์', '10 เปอร์เซ็นท์', '10 per cent', '10 pc'])(
    'flags "%s" as UNLISTED_PERCENT, not UNLISTED_PRICE',
    (text) => {
      const ctx = makeCtx()
      const violations = findDraftViolations(text, ctx)
      expect(violations).toContain('UNLISTED_PERCENT')
      expect(violations).not.toContain('UNLISTED_PRICE')
    },
  )

  it('flags a full-width percent sign "10％" as UNLISTED_PERCENT, not UNLISTED_PRICE', () => {
    const pct = String.fromCharCode(0xff05)
    const ctx = makeCtx()
    const violations = findDraftViolations(`10${pct}`, ctx)
    expect(violations).toContain('UNLISTED_PERCENT')
    expect(violations).not.toContain('UNLISTED_PRICE')
  })

  it('flags a narrow-no-break-space before "%" ("10<U+202F>%") as UNLISTED_PERCENT', () => {
    const nnbsp = String.fromCharCode(0x202f)
    const ctx = makeCtx()
    const violations = findDraftViolations(`10${nnbsp}%`, ctx)
    expect(violations).toContain('UNLISTED_PERCENT')
    expect(violations).not.toContain('UNLISTED_PRICE')
  })

  // Regression guard (assumption, see S18 report): "pc" should only read as
  // percent when followed by a non-letter, so "pcs" must stay a bare amount.
  it('does not misread "pc" inside a longer word as a percent ("10 pcs" stays a bare amount)', () => {
    const ctx = makeCtx()
    const violations = findDraftViolations('10 pcs', ctx)
    expect(violations).toContain('UNLISTED_PRICE')
    expect(violations).not.toContain('UNLISTED_PERCENT')
  })

  it('flags the spelled-out percent "สิบเปอร์เซนต์" (R2, misspelled tone-mark variant) as UNLISTED_PERCENT', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('สิบเปอร์เซนต์', ctx)).toContain('UNLISTED_PERCENT')
  })

  it('R3 hole: a trusted NOTE with a time ("นัด 10:00 น.") must not license "ลด 10 เปอร์เซนต์" (percent needs a trusted percent, not a trusted amount)', () => {
    const ctx = makeCtx({
      recentActivities: [{ at: '2026-09-10T00:00:00.000Z', type: 'NOTE', text: 'นัด 10:00 น.' }],
    })
    expect(findDraftViolations('ลด 10 เปอร์เซนต์', ctx)).toContain('UNLISTED_PERCENT')
  })
})

describe('collectAllowedFigures / findDraftViolations: m3 numbers inside trusted date/time/phone spans must not become trusted amounts (S21 pass 4 MINOR m3)', () => {
  it('a trusted NOTE with a time and a date ("นัด 10:00 น. วันที่ 15 ก.ย.") must not license "ลด 10 บาท"', () => {
    const ctx = makeCtx({
      recentActivities: [{ at: '2026-09-10T00:00:00.000Z', type: 'NOTE', text: 'นัด 10:00 น. วันที่ 15 ก.ย.' }],
    })
    expect(findDraftViolations('ลด 10 บาท', ctx)).toContain('UNLISTED_PRICE')
  })

  it('the same trusted NOTE must not license "ลด 15 บาท" either (15 is the note\'s day-of-month, not a real price)', () => {
    const ctx = makeCtx({
      recentActivities: [{ at: '2026-09-10T00:00:00.000Z', type: 'NOTE', text: 'นัด 10:00 น. วันที่ 15 ก.ย.' }],
    })
    expect(findDraftViolations('ลด 15 บาท', ctx)).toContain('UNLISTED_PRICE')
  })

  it('a trusted OUTBOUND message containing a phone number ("โทร 081-234-5678") must not license "5678 บาท"', () => {
    const ctx = makeCtx({ recentMessages: [outbound('โทร 081-234-5678')] })
    expect(findDraftViolations('5678 บาท', ctx)).toContain('UNLISTED_PRICE')
  })

  it('a plain trusted count still allows the same figure ("ส่งให้ 3 รายการ" allows "3") — regression guard, unaffected by the m3 fix', () => {
    const ctx = makeCtx({ recentMessages: [outbound('ส่งให้ 3 รายการ')] })
    expect(findDraftViolations('3', ctx)).not.toContain('UNLISTED_PRICE')
  })

  it('a plain trusted amount still allows the same figure ("ราคา 45,000 บาท" allows 45,000) — regression guard, unaffected by the m3 fix', () => {
    const ctx = makeCtx({ recentMessages: [outbound('ราคา 45,000 บาท')] })
    expect(findDraftViolations('45,000', ctx)).not.toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: n1 numeric-date year must be range-checked (S21 pass 4 NIT n1)', () => {
  it('flags "15/9/9999" as UNLISTED_PRICE (the numeric-date pattern currently never checks year plausibility at all)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('15/9/9999', ctx)).toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: n2 ตี needs a left word boundary (S21 pass 4 NIT n2)', () => {
  it('flags "ราคาตี 3" as UNLISTED_PRICE (ตี here is the tail of a longer Thai word, not the clock-time construction ตี + hour)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('ราคาตี 3', ctx)).toContain('UNLISTED_PRICE')
  })

  it('still treats standalone "ตี 5" as an exempt clock-time span (regression guard)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('ตี 5', ctx)).not.toContain('UNLISTED_PRICE')
  })

  it('still treats standalone "บ่าย 3" as an exempt clock-time span (regression guard)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('บ่าย 3', ctx)).not.toContain('UNLISTED_PRICE')
  })
})

// S20: gap coverage for the S19 loop, added where cheap and pure. Every case
// below was checked against the existing suite first; only genuinely
// uncovered shapes are added here (see the S20 report for what was already
// covered by S18/S19 and therefore skipped: a bare Extended Arabic-Indic
// (Persian) figure through findDraftViolations, already at M3's "۹۹๐๐ บาท"
// case, and a no-year day+month next to an out-of-window 4-digit currency
// figure, already at M5's "30 ก.ย. 1990 บาท").

describe('findDraftViolations: M4 month-first order, all-caps and lowercase (S20 gap coverage)', () => {
  it('does not flag "MAY 20" (ALL-CAPS month spelling is also an accepted date span, regression guard for the M4 fix)', () => {
    const ctx = makeCtx()
    const violations = findDraftViolations('MAY 20', ctx)
    expect(violations).not.toContain('UNLISTED_PRICE')
    expect(violations).not.toContain('UNLISTED_PERCENT')
  })

  it('flags "may 20" as UNLISTED_PRICE (lowercase "may" is the modal verb, not the month, in month-first order too)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('may 20', ctx)).toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: M2 E2 still rejects a descending range when both sides are small, unit-shaped numbers (S20 gap coverage)', () => {
  it('flags "3-2 วัน" as UNLISTED_PRICE for the left "3" (the right "2" is directly unit-exempt on its own, but a descending range must not lend that exemption to the left number just because both sides are small)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('3-2 วัน', ctx)).toContain('UNLISTED_PRICE')
  })
})

describe('collectAllowedFigures: a trusted text with both a date and a real trusted amount keeps them separate (S20 gap coverage)', () => {
  it('a trusted OUTBOUND message "นัดวันที่ 15 ก.ย. ราคา 9,900 บาท" allows the same "9,900" but still blocks the same "15" (the date span excludes only its own digits, the unrelated amount in the same text is still a genuine trusted figure)', () => {
    const ctx = makeCtx({ recentMessages: [outbound('นัดวันที่ 15 ก.ย. ราคา 9,900 บาท')] })
    const priceViolations = findDraftViolations('ราคา 9,900 บาท', ctx)
    expect(priceViolations).not.toContain('UNLISTED_PRICE')
    const dateViolations = findDraftViolations('ลด 15 บาท', ctx)
    expect(dateViolations).toContain('UNLISTED_PRICE')
  })
})

// ---------------------------------------------------------------------------
// S22 (T-20260915-001 rev 4, pass 5): RED tests for review pass 5 findings
// MAJOR-1..3, m1-m3, n1-n2, plus m3 year-edge/format coverage rows and a
// ReDoS budget row, against the current, not-yet-fixed guardrails.ts. S23
// fixes the matcher; these tests are expected to flip to GREEN there.
// ---------------------------------------------------------------------------

function mathBoldDigit(d: number): string {
  return String.fromCodePoint(0x1d7ce + d)
}
function laoDigit(d: number): string {
  return String.fromCodePoint(0x0ed0 + d)
}
function myanmarDigit(d: number): string {
  return String.fromCodePoint(0x1040 + d)
}
function devanagariDigit(d: number): string {
  return String.fromCodePoint(0x0966 + d)
}
function foreignNumber(digitFn: (d: number) => string, digits: string): string {
  return digits
    .split('')
    .map((c) => (c === ',' ? ',' : digitFn(Number(c))))
    .join('')
}

describe('findDraftViolations: MAJOR-1 a month/date span hides a percent right after it (S21 pass 5)', () => {
  it.each([
    'September 20% off all plans',
    'Sept 15% off',
    'MAY 25% OFF',
    'September 20 percent off',
    'โปร Sept 20% ทุกแพ็กเกจ',
  ])(
    'flags "%s" as UNLISTED_PERCENT (a percent/percent-word right after a month+day span must not be swallowed by the date exemption)',
    (text) => {
      const ctx = makeCtx()
      expect(findDraftViolations(text, ctx)).toContain('UNLISTED_PERCENT')
    },
  )
})

describe('findDraftViolations: MAJOR-2 a date/time span hides a currency-marked amount (S21 pass 5)', () => {
  it.each([
    'โปรถึง 30 ก.ย. 2029 บาท',
    'until Sept 30, 2030 baht',
    'Only $9 p.m.',
    'May 30 THB per user work for you?',
  ])(
    'flags "%s" as UNLISTED_PRICE (a currency symbol/word right before or after a number must win over a date/time span)',
    (text) => {
      const ctx = makeCtx()
      expect(findDraftViolations(text, ctx)).toContain('UNLISTED_PRICE')
    },
  )
})

describe('findDraftViolations: MAJOR-3 unfolded digit scripts must still be scanned (S21 pass 5, flag-by-default)', () => {
  it('flags "ราคา 𝟗,𝟗𝟎𝟎 บาท" (Mathematical Bold digits) as UNLISTED_PRICE', () => {
    const ctx = makeCtx()
    const num = foreignNumber(mathBoldDigit, '9,900')
    expect(findDraftViolations(`ราคา ${num} บาท`, ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags "ลด 𝟓𝟎%" (Mathematical Bold digits before an ASCII percent) as UNLISTED_PERCENT', () => {
    const ctx = makeCtx()
    const num = foreignNumber(mathBoldDigit, '50')
    expect(findDraftViolations(`ลด ${num}%`, ctx)).toContain('UNLISTED_PERCENT')
  })

  it('flags a bare Mathematical Bold number with no currency word as UNLISTED_PRICE (flag-by-default)', () => {
    const ctx = makeCtx()
    const num = foreignNumber(mathBoldDigit, '900')
    expect(findDraftViolations(num, ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags "໙,໙໐໐ บาท" (Lao digits) as UNLISTED_PRICE', () => {
    const ctx = makeCtx()
    const num = foreignNumber(laoDigit, '9,900')
    expect(findDraftViolations(`${num} บาท`, ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags a bare Lao number with no currency word as UNLISTED_PRICE (flag-by-default)', () => {
    const ctx = makeCtx()
    const num = foreignNumber(laoDigit, '900')
    expect(findDraftViolations(num, ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags "ราคา ၉,၉၀၀ บาท" (Myanmar digits) as UNLISTED_PRICE', () => {
    const ctx = makeCtx()
    const num = foreignNumber(myanmarDigit, '9,900')
    expect(findDraftViolations(`ราคา ${num} บาท`, ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags a bare Myanmar number with no currency word as UNLISTED_PRICE (flag-by-default)', () => {
    const ctx = makeCtx()
    const num = foreignNumber(myanmarDigit, '900')
    expect(findDraftViolations(num, ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags "ราคา ९,९०० บาท" (Devanagari digits) as UNLISTED_PRICE', () => {
    const ctx = makeCtx()
    const num = foreignNumber(devanagariDigit, '9,900')
    expect(findDraftViolations(`ราคา ${num} บาท`, ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags a bare Devanagari number with no currency word as UNLISTED_PRICE (flag-by-default)', () => {
    const ctx = makeCtx()
    const num = foreignNumber(devanagariDigit, '900')
    expect(findDraftViolations(num, ctx)).toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: m1 additional percent spellings and multi-space percent marker (S21 pass 5)', () => {
  it('flags "ลด 10 เปอร์" as UNLISTED_PERCENT (เปอร์ alone, short for เปอร์เซ็นต์/เปอร์เซ็น, must still read as a percent marker)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('ลด 10 เปอร์', ctx)).toContain('UNLISTED_PERCENT')
  })

  it('flags "10٪" (U+066A Arabic percent sign) as UNLISTED_PERCENT', () => {
    const arabicPercent = String.fromCharCode(0x066a)
    const ctx = makeCtx()
    expect(findDraftViolations(`10${arabicPercent}`, ctx)).toContain('UNLISTED_PERCENT')
  })

  it('flags "10﹪" (U+FE6A small percent sign) as UNLISTED_PERCENT', () => {
    const smallPercent = String.fromCharCode(0xfe6a)
    const ctx = makeCtx()
    expect(findDraftViolations(`10${smallPercent}`, ctx)).toContain('UNLISTED_PERCENT')
  })

  it('flags "10  %" (two ASCII spaces before the percent sign) as UNLISTED_PERCENT', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('10  %', ctx)).toContain('UNLISTED_PERCENT')
  })

  // R3 leak: a trusted amount ("10" from "ร้าน 10 สาขา") must never license an
  // unrelated draft PERCENT that happens to share the same numeric value:
  // percents and amounts stay separate allow-lists (see the section 4 tests
  // above), so this draft must still flag as a percent even though "10" is a
  // trusted amount.
  it('a trusted lead.title "ร้าน 10 สาขา" does not license draft "ลด 10 เปอร์" (R3 leak, m1)', () => {
    const ctx = makeCtx({ lead: { ...makeCtx().lead, title: 'ร้าน 10 สาขา' } })
    expect(findDraftViolations('ลด 10 เปอร์', ctx)).toContain('UNLISTED_PERCENT')
  })
})

describe('collectAllowedFigures / findDraftViolations: m2 per-text trusted scan (S21 pass 5)', () => {
  // fail closed after revert of the 4+4 phone guard, Pakorn decision
  // 2026-09-16: the `\d{4,}\s\d{4,}` carve-out that used to let a
  // space-separated price run like "9900 12900" escape the phone-candidate
  // check was removed on purpose (S28, "ถอยบรรทัด 774 แล้ว commit"). Every
  // 9-15 digit phone-shaped run in trusted text, including this one, is once
  // again read as a phone span, so neither 9900 nor 12900 is trusted here
  // anymore; a draft repeating either figure must be flagged.
  it('flags draft "9,900" and "12,900" as UNLISTED_PRICE even when trusted OUTBOUND text is "แพ็ก 9900 12900" (fail closed after revert of the 4+4 phone guard, Pakorn decision 2026-09-16)', () => {
    const ctx = makeCtx({ recentMessages: [outbound('แพ็ก 9900 12900')] })
    expect(findDraftViolations('9,900', ctx)).toContain('UNLISTED_PRICE')
    expect(findDraftViolations('12,900', ctx)).toContain('UNLISTED_PRICE')
  })

  // fail closed after revert of the 4+4 phone guard, Pakorn decision
  // 2026-09-16: a genuine trusted phone number must not leak any of its own
  // digit groups as a licensed price figure just because the group also
  // looks like a plausible amount.
  it('a trusted OUTBOUND phone number "โทร 08 1234 5678" does not license draft "ราคา 5678 บาท" (fail closed after revert of the 4+4 phone guard, Pakorn decision 2026-09-16)', () => {
    const ctx = makeCtx({ recentMessages: [outbound('โทร 08 1234 5678')] })
    expect(findDraftViolations('ราคา 5678 บาท', ctx)).toContain('UNLISTED_PRICE')
  })

  it('a trusted OUTBOUND phone number "0812 345678" does not license draft "345678 บาท" (fail closed after revert of the 4+4 phone guard, Pakorn decision 2026-09-16)', () => {
    const ctx = makeCtx({ recentMessages: [outbound('0812 345678')] })
    expect(findDraftViolations('345678 บาท', ctx)).toContain('UNLISTED_PRICE')
  })

  it('does not merge one trusted text ending in digits with the next trusted text starting in digits into one bogus number', () => {
    const ctx = makeCtx({
      recentMessages: [outbound('ยอดสั่งซื้อ 990'), outbound('0 บาทค่ะ')],
    })
    // The two messages must be scanned as separate texts ("990" and "0"), not
    // concatenated into "9900": a draft "9,900" must still be unlisted, and
    // the genuinely trusted "990" must still be allowed.
    expect(findDraftViolations('9,900', ctx)).toContain('UNLISTED_PRICE')
    expect(findDraftViolations('990', ctx)).not.toContain('UNLISTED_PRICE')
  })

  it('still flags an unlisted price "15,900" not present in the trusted text', () => {
    const ctx = makeCtx({ recentMessages: [outbound('แพ็ก 9900 12900')] })
    expect(findDraftViolations('15,900', ctx)).toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: n1 a combining mark before ตี must not license a clock-time reading (S21 pass 5)', () => {
  it('flags "ที่ตี 5" as UNLISTED_PRICE (ตี here is glued onto ที่ via a Thai combining tone mark, not a standalone clock-time construction)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('ที่ตี 5', ctx)).toContain('UNLISTED_PRICE')
  })

  it('still treats standalone "ตี 5" as an exempt clock-time span (regression guard)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('ตี 5', ctx)).not.toContain('UNLISTED_PRICE')
  })

  it('still treats standalone "บ่าย 3" as an exempt clock-time span (regression guard)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('บ่าย 3', ctx)).not.toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: n2 era/year mismatch must not be exempt (S21 pass 5)', () => {
  it('flags "พ.ศ. 2026" as UNLISTED_PRICE (2026 is a CE-window year, not a plausible พ.ศ. year)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('พ.ศ. 2026', ctx)).toContain('UNLISTED_PRICE')
  })

  it('flags "ค.ศ. 2569" as UNLISTED_PRICE (2569 is a BE-window year, not a plausible ค.ศ. year)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('ค.ศ. 2569', ctx)).toContain('UNLISTED_PRICE')
  })

  it('does not flag "พ.ศ. 2569" (era and year window agree, regression guard)', () => {
    const ctx = makeCtx()
    const violations = findDraftViolations('พ.ศ. 2569', ctx)
    expect(violations).not.toContain('UNLISTED_PRICE')
    expect(violations).not.toContain('UNLISTED_PERCENT')
  })

  it('does not flag "ค.ศ. 2026" (era and year window agree, regression guard)', () => {
    const ctx = makeCtx()
    const violations = findDraftViolations('ค.ศ. 2026', ctx)
    expect(violations).not.toContain('UNLISTED_PRICE')
    expect(violations).not.toContain('UNLISTED_PERCENT')
  })
})

describe('findDraftViolations: m3 year-edge coverage across all five year-bearing formats (S21 pass 5)', () => {
  // Window: CE 2020..2035, BE 2563..2578 (today is 2026-09-15). 'green' =
  // expected clean (in-window, valid date span); 'red' = expected flagged
  // (out-of-window, falls back to being a bare number).
  const YEAR_EDGES: Array<[number, 'green' | 'red']> = [
    [2019, 'red'],
    [2020, 'green'],
    [2035, 'green'],
    [2036, 'red'],
    [2562, 'red'],
    [2563, 'green'],
    [2578, 'green'],
    [2579, 'red'],
  ]

  function assertByExpectation(violations: string[], expected: 'green' | 'red') {
    if (expected === 'green') {
      expect(violations).not.toContain('UNLISTED_PRICE')
    } else {
      expect(violations).toContain('UNLISTED_PRICE')
    }
  }

  describe('ISO date (YYYY-MM-DD)', () => {
    it.each(YEAR_EDGES)('year %i is %s: "<year>-09-15"', (year, expected) => {
      const ctx = makeCtx()
      assertByExpectation(findDraftViolations(`${year}-09-15`, ctx), expected)
    })
  })

  describe('numeric date (D/M/YYYY)', () => {
    it.each(YEAR_EDGES)('year %i is %s: "15/9/<year>"', (year, expected) => {
      const ctx = makeCtx()
      assertByExpectation(findDraftViolations(`15/9/${year}`, ctx), expected)
    })
  })

  describe('day + Thai month + year (D ก.ย. YYYY)', () => {
    it.each(YEAR_EDGES)('year %i is %s: "15 ก.ย. <year>"', (year, expected) => {
      const ctx = makeCtx()
      assertByExpectation(findDraftViolations(`15 ก.ย. ${year}`, ctx), expected)
    })
  })

  describe('EN month + day + year (Sept D, YYYY)', () => {
    it.each(YEAR_EDGES)('year %i is %s: "Sept 15, <year>"', (year, expected) => {
      const ctx = makeCtx()
      assertByExpectation(findDraftViolations(`Sept 15, ${year}`, ctx), expected)
    })
  })

  // Corrected for n2 era-aware years (S24): this sub-block used to reuse the
  // shared YEAR_EDGES table and expect "พ.ศ. 2020" / "พ.ศ. 2035" (both
  // CE-window years) to stay clean. That contradicted the n2 regression test
  // above ("พ.ศ. 2026" must flag: a CE-range year after an explicit พ.ศ.
  // marker is not a plausible Buddhist-era year, see isValidYear's
  // era-aware branch). With an explicit พ.ศ. marker, only the BE window
  // (2563..2578) is plausible; every CE-window year (2019/2020/2035/2036)
  // must flag too, same as an out-of-window BE year.
  describe('era + year (พ.ศ. YYYY)', () => {
    const BE_ERA_EDGES: Array<[number, 'green' | 'red']> = [
      [2019, 'red'], // CE-window year, wrong era after พ.ศ.
      [2020, 'red'], // CE-window year, wrong era after พ.ศ.
      [2035, 'red'], // CE-window year, wrong era after พ.ศ.
      [2036, 'red'], // CE-window year, wrong era after พ.ศ.
      [2562, 'red'],
      [2563, 'green'],
      [2578, 'green'],
      [2579, 'red'],
    ]

    it.each(BE_ERA_EDGES)('year %i is %s: "พ.ศ. <year>"', (year, expected) => {
      const ctx = makeCtx()
      assertByExpectation(findDraftViolations(`พ.ศ. ${year}`, ctx), expected)
    })
  })

  // Mirror (S24): an explicit ค.ศ. marker only accepts a CE-window year
  // (2020..2035); a BE-window year after ค.ศ. is the mirror mistake (already
  // pinned once above as "ค.ศ. 2569" must flag) and must flag here too.
  describe('era + year (ค.ศ. YYYY)', () => {
    const CE_ERA_EDGES: Array<[number, 'green' | 'red']> = [
      [2019, 'red'],
      [2020, 'green'],
      [2035, 'green'],
      [2036, 'red'],
      [2562, 'red'], // BE-window year, wrong era after ค.ศ.
      [2563, 'red'], // BE-window year, wrong era after ค.ศ.
      [2578, 'red'], // BE-window year, wrong era after ค.ศ.
      [2579, 'red'],
    ]

    it.each(CE_ERA_EDGES)('year %i is %s: "ค.ศ. <year>"', (year, expected) => {
      const ctx = makeCtx()
      assertByExpectation(findDraftViolations(`ค.ศ. ${year}`, ctx), expected)
    })
  })

  // red: an in-window price right after a day+month with currency must still
  // flag (currency-after must win over the date exemption, MAJOR-2-shaped).
  it('flags "15 ก.ย. 2030 บาท" as UNLISTED_PRICE (in-window year, but a currency word right after must still win)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('15 ก.ย. 2030 บาท', ctx)).toContain('UNLISTED_PRICE')
  })

  // red: a percent right after an EN month must still flag (MAJOR-1-shaped).
  it('flags "Oct 10%" as UNLISTED_PERCENT (a percent right after a month+day span must still win)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('Oct 10%', ctx)).toContain('UNLISTED_PERCENT')
  })

  // green (already correct): an 8-digit phone-like run is one short of the
  // 9-digit PHONE floor, so it is a bare number and must flag as a price.
  it('flags an 8-digit phone-like run "12345678" as UNLISTED_PRICE, not PHONE', () => {
    const ctx = makeCtx()
    const violations = findDraftViolations('12345678', ctx)
    expect(violations).toContain('UNLISTED_PRICE')
    expect(violations).not.toContain('PHONE')
  })

  // green (already correct): a 9-digit run clears the PHONE floor and must
  // report PHONE only, with no bare-digit price noise (same invariant as the
  // "โทร 081-234-5678" case above).
  it("flags a 9-digit phone-like run \"081234567\" as exactly ['PHONE']", () => {
    const ctx = makeCtx()
    expect(findDraftViolations('081234567', ctx)).toEqual(['PHONE'])
  })
})

describe('findDraftViolations / extractFigures: ReDoS guard, sticky currency-after and unfolded-digit inputs (S21 pass 5)', () => {
  const BUDGET_MS = 250
  const RUNS = 3

  function minDuration(fn: () => void): number {
    let best = Infinity
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now()
      fn()
      const duration = performance.now() - start
      if (duration < best) best = duration
    }
    return best
  }

  const PASS5_WORST_CASE_INPUTS: Array<[string, string]> = [
    ["'1 May '.repeat(3000)+'บาท'", '1 May '.repeat(3000) + 'บาท'],
    ["'Sept 1 baht '.repeat(1500)", 'Sept 1 baht '.repeat(1500)],
    ["'𝟗'.repeat(5000)", mathBoldDigit(9).repeat(5000)],
  ]

  it.each(PASS5_WORST_CASE_INPUTS)(
    'findDraftViolations resolves in under 250ms budget (min of 3 runs) for %s',
    (label, input) => {
      const ctx = makeCtx()
      expect(minDuration(() => findDraftViolations(input, ctx))).toBeLessThan(BUDGET_MS)
    },
  )
})

// ---------------------------------------------------------------------------
// S24 (T-20260915-001 rev 4): cheap gap coverage for S23 (MAJOR-1/MAJOR-2/
// MAJOR-3, m3) behavior that S22's RED suite did not already pin.
// ---------------------------------------------------------------------------

describe('findDraftViolations: MAJOR-2 gap coverage, a currency symbol (not just a currency word) right after a date wins (S24)', () => {
  it('flags "Oct 10 ฿" as UNLISTED_PRICE (the ฿ symbol right after a month+day span must still win over the date exemption, same as the currency-word cases above)', () => {
    const ctx = makeCtx()
    expect(findDraftViolations('Oct 10 ฿', ctx)).toContain('UNLISTED_PRICE')
  })
})

describe('findDraftViolations: MAJOR-3 gap coverage, a folded foreign-script figure is still allow-listed against a trusted ASCII value (S24)', () => {
  it('does not flag a Devanagari-digit draft "900" as UNLISTED_PRICE when 900 is trusted via lead.value (normalizeDigits folds before the allow-list check runs)', () => {
    const ctx = makeCtx({ lead: { ...makeCtx().lead, value: 900 } })
    const draft = foreignNumber(devanagariDigit, '900')
    expect(findDraftViolations(draft, ctx)).not.toContain('UNLISTED_PRICE')
  })
})
