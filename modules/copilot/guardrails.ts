import type { LeadContext } from '@/modules/copilot/types'

// [A1] modules/copilot/guardrails.ts: lane owned, pure. See docs/design.md
// section 4 ("Guardrails"). Must NOT import ./fallback (fallback imports
// this module, not the other way round).
//
// Flag-by-default matcher (option C, S16 decision; S17-design.md sections
// 1-4). Every number in a draft is flagged as UNLISTED_PERCENT/UNLISTED_PRICE
// unless it is already trusted, or it falls under one of three narrow
// exemptions: E1 count/duration ("2 วัน", "3 days"), E2 a range joining two
// E1-exempt numbers ("1-2 วันทำการ"), or E3 a validated date/time span. There
// is no more trigger-word gate: a bare untrusted number is flagged by
// default, not only when it sits near a price/discount word.

export const MAX_DRAFT_CHARS = 500

// Bounds every regex below that could otherwise see O(n) match attempts times
// O(n) lookaround work on a pathological input (repeated digit/separator
// runs): findDraftViolations never scans past this many characters.
// extractFigures has no cap (S17 design section 1): it stays safe on the same
// worst-case inputs only because every regex here is itself linear (no nested
// quantifiers, every lookaround anchored to a short, fixed-size slice).
const SCAN_LIMIT = MAX_DRAFT_CHARS * 4

export type GuardrailViolation = 'URL' | 'EMAIL' | 'PHONE' | 'UNLISTED_PERCENT' | 'UNLISTED_PRICE' | 'TOO_LONG'

/** Order the union is declared in; findDraftViolations reports in this order. */
const VIOLATION_ORDER: GuardrailViolation[] = ['URL', 'EMAIL', 'PHONE', 'UNLISTED_PERCENT', 'UNLISTED_PRICE', 'TOO_LONG']

export function clampScore(n: number): number {
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0
}

// Every non-Thai digit/symbol block normalizeDigits also folds to ASCII, each
// a plain 1:1 code-unit offset (never Unicode NFKC: NFKC decomposes Thai ำ
// into สระอำ + a mark, corrupting every unit word that contains it).
// Mathematical Bold digits (U+1D7CE-1D7D7) are deliberately NOT folded here:
// each one is outside the BMP (a surrogate pair, two UTF-16 code units per
// digit), so folding it to a single ASCII digit would break the 1:1
// code-unit offset every fold below promises. Any digit script not
// enumerated below (Mathematical Bold included, or any future one) is caught
// downstream instead by the MAJOR-3 catch-all in scanFigures
// (unfoldedDigitFigures): flagged by default, never silently dropped.
const UNICODE_DIGIT_RE =
  /[๐-๙０-９٠-٩۰-۹％，٪﹪໐-໙၀-၉०-९]/g

/**
 * Digits and percent/comma symbols folded to ASCII, so every numeric regex
 * below only has to know one alphabet: Thai digits (U+0E50-0E59), full-width
 * digits (U+FF10-FF19), Arabic-Indic digits (U+0660-0669), Extended
 * Arabic-Indic/Persian digits (U+06F0-06F9), Lao digits (U+0ED0-0ED9),
 * Myanmar digits (U+1040-1049), Devanagari digits (U+0966-096F), the
 * full-width percent sign (U+FF05), the full-width comma (U+FF0C), the
 * Arabic percent sign (U+066A), and the small percent sign (U+FE6A): all
 * folded to their ASCII equivalent.
 */
export function normalizeDigits(s: string): string {
  return s.replace(UNICODE_DIGIT_RE, (ch) => {
    const code = ch.charCodeAt(0)
    if (code >= 0x0e50 && code <= 0x0e59) return String(code - 0x0e50)
    if (code >= 0xff10 && code <= 0xff19) return String(code - 0xff10)
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660)
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0)
    if (code >= 0x0ed0 && code <= 0x0ed9) return String(code - 0x0ed0)
    if (code >= 0x1040 && code <= 0x1049) return String(code - 0x1040)
    if (code >= 0x0966 && code <= 0x096f) return String(code - 0x0966)
    if (code === 0xff05 || code === 0x066a || code === 0xfe6a) return '%'
    return ',' // code === 0xff0c
  })
}

export const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi
export const URL_RE =
  /(?:https?:\/\/|www\.)\S+|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(?:com|net|org|info|biz|io|co|th|me|ee|app|dev|ly|link|shop|site|online|store|xyz|asia|ai|gl)\b/gi
export const PHONE_CANDIDATE_RE = /\+?\d[\d\s().-]{6,}\d/g

/** Escapes a literal unit word for use inside a regex alternation (only `ชม.` actually needs it, for its dot). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

type Figure = { kind: 'percent' | 'amount'; value: number }
type Span = [start: number, end: number]
type NumTok = {
  start: number
  end: number
  kind: 'percent' | 'amount'
  value: number
  plain: boolean
  // A percent, a malformed number, a number with a multiplier word, or a
  // number with a currency symbol/code right before OR right after it is
  // money-shaped on its face and can never be a mere count/duration, so
  // E1/E2 never apply, and a date/time span (E3) can never hide it either
  // (MAJOR-1/MAJOR-2, S23): see the neverExempt check in scanFigures.
  neverExempt: boolean
}

// --- Section 1: token grammar -----------------------------------------

const NUM_TOKEN_RE = /\d+(?:[.,]\d+)*/g
const PLAIN_NUM_RE = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/

// Longest first, so alternation never locks in a shorter spelling that is a
// prefix of a longer one (เปอร์เซ็น is a prefix of เปอร์เซ็นต์/เปอร์เซ็นท์;
// เปอร์ is in turn a prefix of all four, so it must sort last).
const PERCENT_WORDS = ['เปอร์เซ็นต์', 'เปอร์เซ็นท์', 'เปอร์เซนต์', 'เปอร์เซ็น', 'เปอร์']
  .slice()
  .sort((a, b) => b.length - a.length)
  .join('|')

// Leading optional char class below is a plain space, an NBSP, or a narrow
// NBSP (U+202F) before the marker, bounded to at most two of them (m1, S23:
// "10  %" with two ASCII spaces must still read as a percent). `％`
// (full-width percent), the Arabic percent sign (U+066A), and the small
// percent sign (U+FE6A) never reach this regex directly: normalizeDigits
// already folds all three to ASCII `%` upstream of every call site.
const PERCENT_AFTER_RE = new RegExp(
  String.raw`[   ]{0,2}(?:${PERCENT_WORDS}|percent(?![a-z])|per[  ]cent(?![a-z])|pct(?![a-z])|pc(?![a-z])|%)`,
  'iy',
)
const PERCENT_BEFORE_RE = /ร้อยละ[  ]?$/

const MULT_AFTER_RE = /[  ]?(?:(พัน|หมื่น|แสน|ล้าน)|(k|m|mn|bn|thousand|million|billion)(?![a-z]))/iy
const CURRENCY_BEFORE_RE = /(?:฿|\$|thb|usd)[  ]?$/i

// MAJOR-2 (S23): a currency word/symbol right AFTER a number (not just right
// before it) also makes the number money-shaped on its face, so a date/time
// span must never hide it either ("Only $9 p.m." is already caught by
// CURRENCY_BEFORE_RE via the leading `$`; "May 30 THB" and "...2029 บาท"
// need this sticky check at the token's end instead).
const CURRENCY_AFTER_RE = /[  ]?(?:บาท|฿|baht|thb|usd|dollars?)(?![a-z])/iy

// --- Section 2: exemption grammar --------------------------------------

const TH_UNITS = [
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
  // Longest first: วันทำการ must be tried before วัน, ข้อความ before ข้อ,
  // etc., so alternation never stops at a shorter unit that is a prefix of a
  // longer one.
  .slice()
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join('|')

const EN_UNIT_WORDS = [
  String.raw`(?:business|working|calendar)[  ]days?`,
  'days?',
  'nights?',
  'hours?',
  'hrs?',
  'minutes?',
  'mins?',
  'seconds?',
  'secs?',
  'weeks?',
  'months?',
  'years?',
  'yrs?',
  'people',
  'persons?',
  'times?',
  'branch(?:es)?',
  'items?',
  'steps?',
  'options?',
  'seats?',
  'users?',
  'locations?',
].join('|')

const UNIT_AFTER_RE = new RegExp(
  String.raw`(?:[  ]|-)?(?:(${TH_UNITS})|(?:${EN_UNIT_WORDS})(?![a-z]))`,
  'iy',
)

const CONT_AFTER_RE = /(?:นะครับ|นะคะ|ครับ|ค่ะ|คะ|นะ|จ้ะ|จ้า|และ|หรือ|ให้|จะ|ครึ่ง)/y
// m1 (S21 pass 4): an explicit whitespace class, not \s. \s also matches
// several invisible-ish Unicode space separators (U+FEFF, U+2009, U+202F,
// U+3000 among others), which would otherwise let one of those stand in for
// a real word boundary and mask a disallowed continuation right after a unit
// word ("เดือน<BOM>หน้า" must not read as a legitimate boundary the way
// "เดือน หน้า" with an ordinary space does; the latter is a separate, known
// limit, R1, not something this class is meant to fix).
const BOUNDARY_CHAR_RE = /[ \t\r\n .,!?;:)\]"'”’…]/
const RANGE_JOIN_RE = /[  ]?[-–~][  ]?/y

// --- Section 3 (E3): validated date/time spans -------------------------

const TH_MONTH = String.raw`มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.`
// Title-case or ALL-CAPS only (M4, S21 pass 4): a bare lowercase "may" is the
// modal verb, not the month, and every other English month name is
// unambiguous, so the whole date/time regex this feeds into runs without the
// `i` flag and relies on this explicit case list instead.
const EN_MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sept',
  'sep',
  'oct',
  'nov',
  'dec',
]
  .slice()
  .sort((a, b) => b.length - a.length)

function titleCase(w: string): string {
  return w.charAt(0).toUpperCase() + w.slice(1)
}

const EN_MONTH_CASED = EN_MONTH_NAMES.flatMap((w) => [titleCase(w), w.toUpperCase()]).join('|')
const EN_MONTH = String.raw`(?:${EN_MONTH_CASED})\.?(?![a-zA-Z])`
const ERA = String.raw`(?:พ\.ศ\.|ค\.ศ\.)`
// B/E: a numeric span must not be glued onto another digit (or a decimal/
// thousands separator leading into one), so a longer number is never misread
// as a shorter date/time-shaped prefix or suffix of itself.
const B = String.raw`(?<!\d)(?<!\d[.,])`
const E = String.raw`(?!\d|[.,]\d)`

// Current-era window (today is 2026-09-15): a "any 4-digit number could be a
// year" check would swallow ordinary 4-digit price points (1990, 2490, 2590
// baht) as if they were years. Narrowed to a window around today instead;
// this window must move outward before 2035 (see SKILL.md Deferred).
const MIN_YEAR_CE = 2020
const MAX_YEAR_CE = 2035
const MIN_YEAR_BE = 2563
const MAX_YEAR_BE = 2578

// n2 (S23): with an explicit era marker, only that era's window is
// plausible ("พ.ศ. 2026" is not a real Buddhist-era year even though 2026
// alone is a fine ค.ศ. one; "ค.ศ. 2569" is the mirror mistake). With no era
// marker at all (a bare 4-digit year, or the numeric-date/ISO formats, which
// never carry an era word), either window stays acceptable, unchanged.
function isValidYear(y: number, era?: 'CE' | 'BE'): boolean {
  if (era === 'BE') return y >= MIN_YEAR_BE && y <= MAX_YEAR_BE
  if (era === 'CE') return y >= MIN_YEAR_CE && y <= MAX_YEAR_CE
  return (y >= MIN_YEAR_CE && y <= MAX_YEAR_CE) || (y >= MIN_YEAR_BE && y <= MAX_YEAR_BE)
}
function eraOf(text: string | undefined): 'CE' | 'BE' | undefined {
  if (text === 'ค.ศ.') return 'CE'
  if (text === 'พ.ศ.') return 'BE'
  return undefined
}
function isValidMonth(m: number): boolean {
  return m >= 1 && m <= 12
}
function isValidDay(d: number): boolean {
  return d >= 1 && d <= 31
}

interface DateTimePattern {
  re: RegExp
  valid: (m: RegExpMatchArray) => boolean
}

const DATE_TIME_PATTERNS: DateTimePattern[] = [
  // ISO date: 2026-09-15
  {
    re: new RegExp(String.raw`${B}(\d{4})-(\d{1,2})-(\d{1,2})${E}`, 'g'),
    valid: (m) => isValidYear(Number(m[1])) && isValidMonth(Number(m[2])) && isValidDay(Number(m[3])),
  },
  // Numeric date: 15/9/2569, 15-9-26 (bare "15/9" has no year group, so it
  // never matches this pattern at all and stays a plain flagged number). A
  // 2-digit year is read as 2000+yy (there is no 2-digit BE convention in
  // practice); n1 (S21 pass 4): the year must be range-checked too, or
  // "15/9/9999" slips through as an unvalidated "date".
  {
    re: new RegExp(String.raw`${B}(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})${E}`, 'g'),
    valid: (m) => {
      const a = Number(m[1])
      const b = Number(m[3])
      const yearStr = m[4]
      const year = yearStr.length === 2 ? 2000 + Number(yearStr) : Number(yearStr)
      return a >= 1 && b >= 1 && ((a <= 31 && b <= 12) || (a <= 12 && b <= 31)) && isValidYear(year)
    },
  },
  // วันที่ 15
  {
    re: new RegExp(String.raw`วันที่[  ]?(\d{1,2})${E}`, 'g'),
    valid: (m) => isValidDay(Number(m[1])),
  },
  // Day + month, no year: 15 ก.ย., 15th September. Split from the
  // year-required variant below (M5, S21 pass 4): so that when a trailing
  // 4-digit group turns out not to be a plausible year, the day+month part
  // still stands on its own as a valid span and the 4-digit number is left
  // outside it, to be checked like any other bare number (see M5's "30 ก.ย.
  // 1990 บาท" -> 1990 stays flagged).
  {
    re: new RegExp(String.raw`${B}(\d{1,2})(?:st|nd|rd|th)?[  ]?(?:${TH_MONTH}|${EN_MONTH})`, 'g'),
    valid: (m) => isValidDay(Number(m[1])),
  },
  // Day + month + year (year required): 15 ก.ย. 2569
  {
    re: new RegExp(
      String.raw`${B}(\d{1,2})(?:st|nd|rd|th)?[  ]?(?:${TH_MONTH}|${EN_MONTH})[  ]?,?[  ]?(${ERA})?[  ]?(\d{4})${E}`,
      'g',
    ),
    valid: (m) => isValidDay(Number(m[1])) && isValidYear(Number(m[3]), eraOf(m[2])),
  },
  // Month + day (EN), no year: September 15, Sept 15
  {
    re: new RegExp(String.raw`(?<![a-zA-Z])${EN_MONTH}[  ]?(\d{1,2})(?:st|nd|rd|th)?${E}`, 'g'),
    valid: (m) => isValidDay(Number(m[1])),
  },
  // Month + day + year (EN, year required): Sept 15, 2026
  {
    re: new RegExp(
      String.raw`(?<![a-zA-Z])${EN_MONTH}[  ]?(\d{1,2})(?:st|nd|rd|th)?${E},?[  ]?(\d{4})${E}`,
      'g',
    ),
    valid: (m) => isValidDay(Number(m[1])) && isValidYear(Number(m[2])),
  },
  // Era + year: พ.ศ. 2569
  {
    re: new RegExp(String.raw`(${ERA})[  ]?(\d{4})${E}`, 'g'),
    valid: (m) => isValidYear(Number(m[2]), eraOf(m[1])),
  },
  // Ordinal day: 15th
  {
    re: new RegExp(String.raw`${B}(\d{1,2})(?:st|nd|rd|th)(?![a-z])`, 'gi'),
    valid: (m) => isValidDay(Number(m[1])),
  },
  // Colon time: 10:00, 10:00 น., 10:00pm
  {
    re: new RegExp(
      String.raw`${B}([01]?\d|2[0-3]):([0-5]\d)(?:[  ]?(?:น\.|นาฬิกา|a\.m\.|p\.m\.|am|pm)(?![a-z]))?${E}`,
      'gi',
    ),
    valid: () => true,
  },
  // Dot time: 10.00 น. (suffix required, so a plain decimal is never eaten)
  {
    re: new RegExp(String.raw`${B}([01]?\d|2[0-3])\.([0-5]\d)[  ]?(?:น\.|นาฬิกา)`, 'g'),
    valid: () => true,
  },
  // Thai clock words: 3 โมงเย็น, 2 ทุ่ม, 10 นาฬิกา
  {
    re: new RegExp(String.raw`${B}(\d{1,2})[  ]?(โมงเช้า|โมงเย็น|โมง|ทุ่ม|นาฬิกา)`, 'g'),
    valid: (m) => {
      const h = Number(m[1])
      if (m[2] === 'ทุ่ม') return h >= 1 && h <= 6
      if (m[2] === 'นาฬิกา') return h >= 0 && h <= 24
      return h >= 1 && h <= 12
    },
  },
  // ตี 3, บ่าย 2. n2 (S21 pass 4): must not be preceded by a letter, so "ตี"
  // as the tail of an unrelated word (ราคาตี) is not read as the clock-time
  // construction. n1 (S23): must also not be preceded by a combining mark
  // (\p{M}, a Thai vowel sign or tone mark glued onto the previous
  // consonant), so "ที่ตี 5" (ตี glued onto ที่ via the tone mark ่) is not
  // misread as clock time either. `u` flag needed for the \p{L}/\p{M}
  // classes; nothing else in this pattern depends on the `u` flag's
  // stricter escape rules.
  {
    re: new RegExp(String.raw`(?<![\p{L}\p{M}])(?:ตี|บ่าย)[  ]?(\d{1,2})${E}`, 'gu'),
    valid: (m) => {
      const h = Number(m[1])
      return h >= 1 && h <= 6
    },
  },
  // English clock: 10pm, 9 o'clock
  {
    re: new RegExp(
      String.raw`${B}(1[0-2]|0?[1-9])(?::[0-5]\d)?[  ]?(?:a\.m\.|p\.m\.|am|pm|o'clock|o’clock)(?![a-z])`,
      'gi',
    ),
    valid: () => true,
  },
]

function dateTimeSpans(s: string): Span[] {
  const spans: Span[] = []
  for (const { re, valid } of DATE_TIME_PATTERNS) {
    for (const m of s.matchAll(re)) {
      const idx = m.index ?? 0
      if (valid(m)) spans.push([idx, idx + m[0].length])
    }
  }
  return sortMerge(spans)
}

// --- Section 3: R2 spelled-out numbers next to a currency/percent word ---

// m2 (S21 pass 4): every percent spelling PERCENT_AFTER_RE also recognizes,
// plus "per cent" and "pc" (checked with the same outer (?![a-z]) as every
// other English alternative here, so "pcs" never matches "pc"). m1 (S23):
// เปอร์ added too, so "ห้าเปอร์" is spotted the same as the longer spellings
// (longest-first, same reasoning as PERCENT_WORDS above).
const MONEY_SUFFIX_RE =
  /บาท|เปอร์เซ็นต์|เปอร์เซ็นท์|เปอร์เซนต์|เปอร์เซ็น|เปอร์|%|(?<![a-z])(?:baht|thb|percent|per cent|pc|dollars?|usd)(?![a-z])/gi
const THAI_NUM_WORD_TAIL_RE =
  /(?:ศูนย์|หนึ่ง|เอ็ด|สอง|ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน)[  ]?$/
const EN_NUM_WORD_TAIL_RE =
  /(?<![a-z])(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)[  -]?$/i
const ROI_LA_NUM_WORD_RE =
  /ร้อยละ[  ]?(?:ศูนย์|หนึ่ง|เอ็ด|สอง|ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน)/g
const PERCENT_SUFFIX_WORDS = new Set(['เปอร์เซ็นต์', 'เปอร์เซ็นท์', 'เปอร์เซนต์', 'เปอร์เซ็น', 'เปอร์', '%'])

function isPercentSuffixWord(word: string): boolean {
  if (PERCENT_SUFFIX_WORDS.has(word)) return true
  const lower = word.toLowerCase()
  return lower === 'percent' || lower === 'pc' || lower === 'per cent'
}

/**
 * Spelled-out amounts/percents next to a currency or percent word (ห้าพันบาท,
 * สิบเปอร์เซ็นต์, ร้อยละสิบ): never parseable to a number, so always {value:
 * NaN}, which findDraftViolations treats as never-allowed. Skipped when a
 * digit immediately precedes the spelled number word (1.5 ล้านบาท, 5
 * พันบาท): the digit scanner above already turned that into a real, parsed
 * figure, so this would otherwise double-count the same mention.
 */
function spelledMoneyFigures(s: string): Figure[] {
  const figures: Figure[] = []

  for (const m of s.matchAll(MONEY_SUFFIX_RE)) {
    const idx = m.index ?? 0
    const sliceStart = Math.max(0, idx - 24)
    const slice = s.slice(sliceStart, idx)

    const tailMatch = THAI_NUM_WORD_TAIL_RE.exec(slice) ?? EN_NUM_WORD_TAIL_RE.exec(slice)
    if (!tailMatch) continue

    const wordStart = sliceStart + tailMatch.index
    const beforeWord = s.slice(Math.max(0, wordStart - 2), wordStart)
    if (/\d[  ]?$/.test(beforeWord)) continue

    figures.push({ kind: isPercentSuffixWord(m[0]) ? 'percent' : 'amount', value: Number.NaN })
  }

  const roiLaCount = (s.match(ROI_LA_NUM_WORD_RE) ?? []).length
  for (let i = 0; i < roiLaCount; i++) {
    figures.push({ kind: 'percent', value: Number.NaN })
  }

  return figures
}

// --- Section 4: MAJOR-3 catch-all for un-enumerated Unicode digit scripts -

// Any \p{Nd} (Unicode decimal digit) character NUM_TOKEN_RE cannot see
// (`\d` is ASCII-only) and normalizeDigits does not fold on purpose
// (Mathematical Bold digits, or any other digit script nobody has
// enumerated yet) must still flag by default rather than vanish silently.
// One regex pass, no nested quantifiers, so it stays linear even on a long
// repeated-digit input (see the ReDoS guard tests).
const FOREIGN_DIGIT_RUN_RE = /\p{Nd}+/gu

/** True if any code point in `run` is outside plain ASCII '0'-'9' (a script normalizeDigits already folds never reaches here as anything but ASCII). */
function hasNonAsciiDigit(run: string): boolean {
  for (const ch of run) {
    if (ch < '0' || ch > '9') return true
  }
  return false
}

/**
 * MAJOR-3: one always-flagged {kind, value: NaN} figure per maximal run of
 * un-enumerated Unicode digits, classified as a percent only when a percent
 * marker immediately follows the run ("ลด 50% ", with 50 in Mathematical
 * Bold), so it reports the same violation code an ASCII "50%" would.
 */
function unfoldedDigitFigures(s: string): Figure[] {
  const figures: Figure[] = []
  for (const m of s.matchAll(FOREIGN_DIGIT_RUN_RE)) {
    const run = m[0]
    if (!hasNonAsciiDigit(run)) continue
    const end = (m.index ?? 0) + run.length
    const percentAfter = stickyAt(PERCENT_AFTER_RE, s, end) !== null
    figures.push({ kind: percentAfter ? 'percent' : 'amount', value: Number.NaN })
  }
  return figures
}

// --- Shared helpers ------------------------------------------------------

function stickyAt(re: RegExp, s: string, i: number): RegExpExecArray | null {
  re.lastIndex = i
  return re.exec(s)
}

function multiplierValue(word: string | undefined): number {
  switch (word?.toLowerCase()) {
    case 'พัน':
    case 'thousand':
    case 'k':
      return 1_000
    case 'หมื่น':
      return 10_000
    case 'แสน':
      return 100_000
    case 'ล้าน':
    case 'million':
    case 'm':
    case 'mn':
      return 1_000_000
    case 'bn':
    case 'billion':
      return 1_000_000_000
    default:
      return 1
  }
}

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100
}

function sortMerge(...lists: Span[][]): Span[] {
  const all = lists.flat().sort((a, b) => a[0] - b[0])
  const merged: Span[] = []
  for (const span of all) {
    const last = merged[merged.length - 1]
    if (last && span[0] <= last[1]) {
      last[1] = Math.max(last[1], span[1])
    } else {
      merged.push([span[0], span[1]])
    }
  }
  return merged
}

function tokenize(s: string): NumTok[] {
  const toks: NumTok[] = []

  for (const m of s.matchAll(NUM_TOKEN_RE)) {
    const raw = m[0]
    const start = m.index ?? 0
    const end = start + raw.length
    const plain = PLAIN_NUM_RE.test(raw)
    const base = plain ? Number(raw.replace(/,/g, '')) : Number.NaN

    const percentAfter = stickyAt(PERCENT_AFTER_RE, s, end) !== null
    const percentBefore = !percentAfter && PERCENT_BEFORE_RE.test(s.slice(Math.max(0, start - 8), start))

    if (percentAfter || percentBefore) {
      toks.push({
        start,
        end,
        kind: 'percent',
        value: plain ? roundTo2(base) : Number.NaN,
        plain,
        neverExempt: true,
      })
      continue
    }

    const multMatch = stickyAt(MULT_AFTER_RE, s, end)
    const hasMultiplier = multMatch !== null
    const multWord = multMatch ? (multMatch[1] ?? multMatch[2]) : undefined
    const hasCurrencyBefore = CURRENCY_BEFORE_RE.test(s.slice(Math.max(0, start - 5), start))
    // MAJOR-2 (S23): a currency word right AFTER the number ("30 THB", "2029
    // บาท") is just as money-shaped as one right before it.
    const hasCurrencyAfter = stickyAt(CURRENCY_AFTER_RE, s, end) !== null

    toks.push({
      start,
      end,
      kind: 'amount',
      value: plain ? roundTo2(base * multiplierValue(multWord)) : Number.NaN,
      plain,
      neverExempt: !plain || hasMultiplier || hasCurrencyBefore || hasCurrencyAfter,
    })
  }

  return toks
}

function continuationOk(s: string, i: number, thUnit: string | undefined): boolean {
  if (i === s.length) return true
  if (BOUNDARY_CHAR_RE.test(s[i])) return true
  if (stickyAt(CONT_AFTER_RE, s, i) !== null) return true
  // ที่แล้ว ("...ago") is only an approved continuation right after วัน
  // itself, never after เดือน/ปี/etc: "3 วันที่แล้ว" is a duration, "9,900
  // เดือนที่แล้ว" is a price next to an unrelated "last month".
  if (thUnit === 'วัน' && s.startsWith('ที่แล้ว', i)) return true
  return false
}

/** E1: a plain count/duration number immediately followed by an approved unit and an approved continuation. */
function unitExempt(s: string, t: NumTok): boolean {
  if (t.neverExempt) return false
  const m = stickyAt(UNIT_AFTER_RE, s, t.end)
  if (!m) return false
  const unitEnd = t.end + m[0].length
  return continuationOk(s, unitEnd, m[1])
}

/** E1 || E2, right to left so a range's left number can see whether its right neighbor already qualified. */
function exemptFlags(s: string, toks: NumTok[]): boolean[] {
  const flags = new Array<boolean>(toks.length).fill(false)

  for (let i = toks.length - 1; i >= 0; i--) {
    const t = toks[i]
    if (unitExempt(s, t)) {
      flags[i] = true
      continue
    }
    // M1 (S21 pass 4): a never-exempt token (a percent, or an amount with a
    // multiplier/currency symbol right before it) is money-shaped on its
    // face and must never be swept into E2 via an E1-exempt neighbor, even
    // though every non-plain token is already neverExempt (so this also
    // covers the `!t.plain` case below on its own).
    if (t.neverExempt) continue
    if (!t.plain) continue
    const next = toks[i + 1]
    if (!next || !flags[i + 1]) continue
    const joinMatch = stickyAt(RANGE_JOIN_RE, s, t.end)
    // M2 (S21 pass 4): E2 only joins an ascending range ("1-2 วัน", not
    // "9,900 - 3 วัน"): the left number must be a genuine smaller range
    // partner of the unit-exempt right number, not an unrelated price that
    // happens to sit next to a dash and a duration.
    if (
      joinMatch &&
      t.end + joinMatch[0].length === next.start &&
      Number.isFinite(t.value) &&
      Number.isFinite(next.value) &&
      t.value < next.value
    ) {
      flags[i] = true
    }
  }

  return flags
}

/**
 * `hardSkip` (URL/EMAIL/PHONE spans) always hides a fully-contained token, no
 * exception. `dateSkip` (validated E3 date/time spans) hides a fully
 * contained token too, UNLESS that token is money-shaped on its face
 * (`neverExempt`: a percent, a multiplier, or a currency symbol/word right
 * before or right after it): MAJOR-1/MAJOR-2 (S23), a date/time span must
 * never hide a percent or a currency-marked amount right next to it; that
 * token still goes through the normal exempt/allow-list check below like any
 * other number, it is just not auto-exempt via E3.
 */
function scanFigures(s: string, hardSkip: Span[], dateSkip: Span[]): Figure[] {
  const toks = tokenize(s)
  const exempt = exemptFlags(s, toks)
  const figures: Figure[] = []

  let hi = 0
  let di = 0
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]

    while (hi < hardSkip.length && hardSkip[hi][1] <= t.start) hi++
    const insideHardSkip = hi < hardSkip.length && hardSkip[hi][0] <= t.start && t.end <= hardSkip[hi][1]
    if (insideHardSkip) continue

    while (di < dateSkip.length && dateSkip[di][1] <= t.start) di++
    const insideDateSkip = di < dateSkip.length && dateSkip[di][0] <= t.start && t.end <= dateSkip[di][1]
    if (insideDateSkip && !t.neverExempt) continue

    if (exempt[i]) continue
    figures.push({ kind: t.kind, value: t.value })
  }

  figures.push(...spelledMoneyFigures(s))
  figures.push(...unfoldedDigitFigures(s))
  return figures
}

/**
 * Every number in `text`, with no email/URL/phone masking and no SCAN_LIMIT
 * cap: safe on an unbounded input because every regex above is linear (see
 * the ReDoS-guard tests), not because the input is capped first.
 */
export function extractFigures(text: string): Figure[] {
  const s = normalizeDigits(text)
  return scanFigures(s, [], dateTimeSpans(s))
}

// Activity types whose `text` (Activity.body) is always typed in by a
// signed-in human through the app (POST /api/leads/[id]/activities, or the
// text the human already approved before it went out over LINE), never
// something Lanes A/C copy in verbatim from customer-controlled input like a
// LINE display name or CONTACT_CREATED_FROM_LINE's body. Every other
// ActivityType is left out on purpose (most carry no free-text body at all;
// the ones that could are excluded out of caution).
const TRUSTED_ACTIVITY_TYPES: ReadonlySet<LeadContext['recentActivities'][number]['type']> = new Set([
  'NOTE',
  'CALL',
  'MEETING',
  'EMAIL',
  'MESSAGE_SENT',
])

/**
 * Figures the draft is allowed to repeat: every percent/amount token in
 * TRUSTED text (lead.title, OUTBOUND message texts, and human-authored
 * activity texts, see TRUSTED_ACTIVITY_TYPES) plus lead.value, with no E1/E2
 * count/duration/range exemption applied to trusted text (every number in
 * trusted text still counts as itself, including one that would otherwise
 * look like a count/duration). m3 (S21 pass 4): a number that falls inside a
 * validated date/time span, or inside a phone-shaped run of digits, in the
 * trusted text is excluded from both lists: it is a day-of-month, an hour, or
 * a phone digit group, never a real trusted amount or percent, so it must not
 * license an unrelated untrusted number that happens to share its value
 * ("นัด 10:00 น." must not license a bare untrusted "10"). Percent and amount
 * are separate allow-lists: a trusted 10% never licenses a bare untrusted 10,
 * and a trusted "1.5 ล้าน" never licenses a bare untrusted 1.5, only the
 * resolved 1,500,000. Inbound (customer) text is never trusted, so an
 * injected "ส่วนลด 90%" cannot make 90% an allowed figure. lead.title is
 * trusted too: it must never embed raw customer text (see SKILL.md).
 */
export function collectAllowedFigures(ctx: LeadContext): { percents: number[]; amounts: number[] } {
  const trustedTexts = [
    ctx.lead.title,
    ...ctx.recentMessages.filter((m) => m.direction === 'OUTBOUND').map((m) => m.text),
    ...ctx.recentActivities
      .filter((a) => TRUSTED_ACTIVITY_TYPES.has(a.type))
      .map((a) => a.text)
      .filter((t): t is string => t !== null),
  ].map(normalizeDigits)

  // m2 (S23): date/time and phone-candidate spans are computed PER trusted
  // text, not on the '\n'-joined string, then offset back into `combined`.
  // Running PHONE_CANDIDATE_RE on the joined text let a single OUTBOUND
  // message's own space-separated prices ("แพ็ก 9900 12900", 9 digits total)
  // read as one fake phone-shaped run, dropping BOTH prices from the
  // allow-list; per-text scanning also stops PHONE_CANDIDATE_RE's `\s` class
  // from ever bridging the '\n' join between two different trusted texts.
  const untrustedLikeSpans: Span[] = []
  let offset = 0
  for (const text of trustedTexts) {
    const phoneSpans: Span[] = []
    for (const m of text.matchAll(PHONE_CANDIDATE_RE)) {
      const digitCount = (m[0].match(/\d/g) ?? []).length
      if (digitCount >= 9 && digitCount <= 15) {
        const idx = m.index ?? 0
        phoneSpans.push([idx, idx + m[0].length])
      }
    }
    for (const [s0, s1] of sortMerge(dateTimeSpans(text), phoneSpans)) {
      untrustedLikeSpans.push([offset + s0, offset + s1])
    }
    offset += text.length + 1 // +1 for the '\n' join separator below
  }
  const mergedUntrustedLikeSpans = sortMerge(untrustedLikeSpans)
  const combined = trustedTexts.join('\n')

  const percents: number[] = []
  const bareAmounts: number[] = []
  let si = 0
  for (const t of tokenize(combined)) {
    if (!Number.isFinite(t.value)) continue
    while (si < mergedUntrustedLikeSpans.length && mergedUntrustedLikeSpans[si][1] <= t.start) si++
    const span = mergedUntrustedLikeSpans[si]
    if (span && span[0] <= t.start && t.end <= span[1]) continue
    if (t.kind === 'percent') percents.push(t.value)
    else bareAmounts.push(t.value)
  }

  const amounts = ctx.lead.value !== null ? [...bareAmounts, ctx.lead.value] : bareAmounts

  return { percents, amounts }
}

function isAllowedFigure(value: number, allowed: number[]): boolean {
  return allowed.some((a) => Math.abs(a - value) < 0.005)
}

/** Deduped, reported in GuardrailViolation's declared order. Every check other than TOO_LONG runs on normalizeDigits(text).slice(0, SCAN_LIMIT). */
export function findDraftViolations(text: string, ctx: LeadContext): GuardrailViolation[] {
  const found = new Set<GuardrailViolation>()
  const s = normalizeDigits(text).slice(0, SCAN_LIMIT)

  const emailSpans: Span[] = []
  for (const m of s.matchAll(EMAIL_RE)) {
    found.add('EMAIL')
    const idx = m.index ?? 0
    emailSpans.push([idx, idx + m[0].length])
  }

  const withoutEmails = emailSpans.length > 0 ? s.replace(EMAIL_RE, (m) => ' '.repeat(m.length)) : s
  const urlSpans: Span[] = []
  for (const m of withoutEmails.matchAll(URL_RE)) {
    found.add('URL')
    const idx = m.index ?? 0
    urlSpans.push([idx, idx + m[0].length])
  }

  const phoneSpans: Span[] = []
  for (const m of s.matchAll(PHONE_CANDIDATE_RE)) {
    const digitCount = (m[0].match(/\d/g) ?? []).length
    if (digitCount >= 9 && digitCount <= 15) {
      found.add('PHONE')
      const idx = m.index ?? 0
      phoneSpans.push([idx, idx + m[0].length])
    }
  }

  // hardSkip (URL/EMAIL/PHONE) always hides a fully-contained number;
  // dateSkip (E3) does too, UNLESS the number is money-shaped (MAJOR-1/
  // MAJOR-2, S23): see scanFigures.
  const hardSkip = sortMerge(emailSpans, urlSpans, phoneSpans)
  const dateSkip = dateTimeSpans(s)

  const allowed = collectAllowedFigures(ctx)
  for (const figure of scanFigures(s, hardSkip, dateSkip)) {
    if (figure.kind === 'percent') {
      if (!isAllowedFigure(figure.value, allowed.percents)) found.add('UNLISTED_PERCENT')
    } else if (!isAllowedFigure(figure.value, allowed.amounts)) {
      found.add('UNLISTED_PRICE')
    }
  }

  if (text.length > MAX_DRAFT_CHARS) found.add('TOO_LONG')

  return VIOLATION_ORDER.filter((v) => found.has(v))
}
