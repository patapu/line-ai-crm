import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type LeadStage, type LeadSource } from '../lib/generated/prisma/client'
import { hashPassword } from '../lib/auth/password'

// [A] prisma/seed.ts: deterministic, idempotent demo data for the shared dev
// database. Run via `npm run db:seed` -> `prisma db seed` -> `tsx
// --conditions=react-server prisma/seed.ts` (prisma.config.ts).
//
// Rules this file must never break:
// - Relative imports only (no `@/lib/db` or `@/lib/env`: `getEnv` would
//   demand SESSION_SECRET/APP_URL for no reason, and `getDb` has no
//   disconnect path this script needs).
// - Only `upsert` (Users) and `createMany({ skipDuplicates: true })`
//   (everything else). NEVER delete, truncate, or update a non-seed row:
//   lanes B and C read and write this same database.
// - Fully deterministic: one PRNG seed, one fixed reference date, all rows
//   generated in a fixed order before any DB write. Running this script
//   twice must produce identical rows.

const DAY_MS = 24 * 60 * 60 * 1000
// Fixed reference "now" for the seed's fictional timeline. Never Date.now().
const BASE = Date.UTC(2026, 8, 1)

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------

/** mulberry32: tiny deterministic PRNG. Same seed -> same sequence, always. */
function mulberry32(seed: number): () => number {
  let a = seed
  return function (): number {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20260915)

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]
}

function int(min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1))
}

function chance(probability: number): boolean {
  return rand() < probability
}

function weightedPick<T extends string>(weights: readonly (readonly [T, number])[]): T {
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = rand() * total
  for (const [value, weight] of weights) {
    roll -= weight
    if (roll <= 0) return value
  }
  return weights[weights.length - 1][0]
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

// ---------------------------------------------------------------------------
// Fixed synthetic data lists (Thai, no real customer data)
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  'สมชาย', 'สมหญิง', 'วิชัย', 'วิภา', 'ประยุทธ', 'กมลา', 'อนุชา', 'มาลี', 'สุชาติ', 'รัตนา',
  'ธนากร', 'พรทิพย์', 'ชัยวัฒน์', 'สุนีย์', 'วีระ', 'อรุณี', 'ปิยะ', 'สุภาพร', 'ธีรพงษ์', 'กัญญา',
  'นพดล', 'จิราภรณ์', 'ศักดิ์ชัย', 'วรรณา', 'ประเสริฐ', 'สุดา', 'ชาญชัย', 'นงลักษณ์', 'อนันต์', 'พิมพ์ใจ',
  'สุรชัย', 'กาญจนา', 'ธวัชชัย', 'อำไพ', 'วิรัตน์', 'สมศรี', 'ประพันธ์', 'ลัดดา', 'ไพโรจน์', 'จันทร์เพ็ญ',
  'เกียรติศักดิ์', 'พัชรี', 'สุวิทย์', 'อรทัย', 'ณรงค์',
] as const

const LAST_NAMES = [
  'ใจดี', 'สุขสันต์', 'รักไทย', 'มั่นคง', 'เจริญสุข', 'พูลทรัพย์', 'ศรีสุข', 'แก้วมณี', 'บุญมี', 'ทองดี',
  'สายทอง', 'วงศ์ษา', 'ปัญญาดี', 'สมบูรณ์', 'ธนาสาร', 'พงษ์พันธุ์', 'รุ่งเรือง', 'ศิริวัฒน์', 'จันทร์แก้ว', 'สุวรรณ',
  'ทรัพย์สิน', 'มีสุข', 'วิไลลักษณ์', 'ประสิทธิ์', 'กิจเจริญ', 'ธรรมชาติ', 'ศรีวิไล', 'บุญเลิศ', 'สงวนศักดิ์', 'พิพัฒน์',
  'อยู่ดี', 'สุขใจ', 'เกษมสุข', 'ทวีทรัพย์', 'ศักดิ์สิทธิ์', 'มงคล', 'ไทยเจริญ', 'วัฒนกุล', 'พรหมมา', 'สินสมบูรณ์',
  'เพชรรัตน์', 'ศรีสมบูรณ์', 'คงเจริญ', 'บุญประเสริฐ', 'ทองสุข',
] as const

const COMPANY_PREFIX = [
  'ไทย', 'สยาม', 'กรุงเทพ', 'เอเชีย', 'แปซิฟิก', 'สหมิตร', 'รุ่งเรือง', 'เจริญ', 'มั่นคง', 'ยูไนเต็ด',
  'โกลบอล', 'เนชั่นแนล', 'อินเตอร์', 'แกรนด์', 'เมโทร', 'ปทุม', 'นวัตกรรม', 'สุวรรณภูมิ',
] as const

const COMPANY_CORE = [
  'พัฒนา', 'การค้า', 'อุตสาหกรรม', 'เทคโนโลยี', 'ก่อสร้าง', 'ขนส่ง', 'พาณิชย์', 'ธุรกิจ', 'การเงิน', 'อาหาร',
  'เกษตร', 'พลังงาน', 'สื่อสาร', 'ท่องเที่ยว', 'สุขภาพ', 'การศึกษา', 'ประกันภัย', 'อสังหาริมทรัพย์',
] as const

const COMPANY_SUFFIX = [
  'จำกัด', 'จำกัด (มหาชน)', 'กรุ๊ป', 'โฮลดิ้ง', 'อินเตอร์เนชั่นแนล', 'คอร์ปอเรชั่น', 'เอ็นเตอร์ไพรส์', 'แอนด์พาร์ทเนอร์ส',
  'ซัพพลาย', 'โลจิสติกส์', 'เซอร์วิส', 'แมนูแฟคเจอริ่ง', 'ดีเวลลอปเมนท์', 'เทรดดิ้ง', 'อินดัสตรี', 'คอนซัลติ้ง',
  'พาร์ทเนอร์ส', 'โซลูชั่น',
] as const

const INDUSTRIES = [
  'เทคโนโลยี', 'การเงิน', 'การผลิต', 'ค้าปลีก', 'สุขภาพ', 'การศึกษา', 'อสังหาริมทรัพย์', 'โลจิสติกส์', 'พลังงาน', 'เกษตรกรรม',
] as const

const SIZE_BANDS = ['1-10', '11-50', '51-200', '201-500', '500+'] as const

const LOST_REASONS = [
  'ราคาสูงเกินไป', 'เลือกคู่แข่ง', 'งบประมาณไม่พอ', 'ไม่ตอบกลับ', 'ยกเลิกโครงการ', 'เปลี่ยนความต้องการ', 'หมดความสนใจ',
] as const

const SEED_USERS: readonly { email: string; name: string; role: 'ADMIN' | 'SALES' }[] = [
  { email: 'admin@crm.test', name: 'ผู้ดูแลระบบ สาธิต', role: 'ADMIN' },
  { email: 'sales1@crm.test', name: 'สมชาย ขายดี', role: 'SALES' },
  { email: 'sales2@crm.test', name: 'สมหญิง ขายเก่ง', role: 'SALES' },
  { email: 'sales3@crm.test', name: 'วิชัย ปิดการขาย', role: 'SALES' },
  { email: 'sales4@crm.test', name: 'วิภา ลูกค้าสัมพันธ์', role: 'SALES' },
  { email: 'sales5@crm.test', name: 'ประยุทธ ดูแลลูกค้า', role: 'SALES' },
]

const CONTACT_SOURCE_WEIGHTS: readonly (readonly [LeadSource, number])[] = [
  ['WEBSITE', 45],
  ['MANUAL', 40],
  ['LINE', 15],
]

const OPEN_STAGE_WEIGHTS: readonly (readonly [LeadStage, number])[] = [
  ['NEW', 40],
  ['QUALIFIED', 35],
  ['PROPOSAL', 25],
]

const CLOSED_STAGE_WEIGHTS: readonly (readonly [LeadStage, number])[] = [
  ['WON', 55],
  ['LOST', 45],
]

// ---------------------------------------------------------------------------
// Row shapes (mirrors the *CreateManyInput shape Prisma generates)
// ---------------------------------------------------------------------------

interface CompanySeed {
  id: string
  name: string
  domain: string
  industry: string
  sizeBand: string
  createdById: string
  createdAt: Date
  updatedAt: Date
}

interface ContactSeed {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  lineUserId: string | null
  lineDisplayName: string | null
  source: LeadSource
  companyId: string | null
  ownerId: string
  createdAt: Date
  updatedAt: Date
}

interface LeadSeed {
  id: string
  title: string
  stage: LeadStage
  source: LeadSource
  value: number | null
  score: number | null
  scoreUpdatedAt: Date | null
  lostReason: string | null
  stageChangedAt: Date
  closedAt: Date | null
  contactId: string
  companyId: string | null
  ownerId: string
  createdById: string
  createdAt: Date
  updatedAt: Date
}

interface ActivitySeed {
  id: string
  leadId: string
  type: 'LEAD_CREATED' | 'STAGE_CHANGED'
  meta: { source: LeadSource; seed: true } | { from: 'NEW'; to: LeadStage; reason: string | null }
  actorId: string
  createdAt: Date
}

// ---------------------------------------------------------------------------
// Row generation (pure, no DB access — everything is built before any write)
// ---------------------------------------------------------------------------

function buildCompanies(adminId: string): CompanySeed[] {
  const companies: CompanySeed[] = []
  for (let i = 1; i <= 150; i++) {
    const createdAt = new Date(BASE - int(0, 365) * DAY_MS)
    companies.push({
      id: `cseedcomp${pad(i, 4)}`,
      name: `${pick(COMPANY_PREFIX)}${pick(COMPANY_CORE)} ${pick(COMPANY_SUFFIX)}`,
      domain: `seed-co-${pad(i, 4)}.example.com`,
      industry: pick(INDUSTRIES),
      sizeBand: pick(SIZE_BANDS),
      createdById: adminId,
      createdAt,
      updatedAt: createdAt,
    })
  }
  return companies
}

function buildContacts(companies: CompanySeed[], salesUserIds: string[]): ContactSeed[] {
  const contacts: ContactSeed[] = []
  for (let i = 1; i <= 2000; i++) {
    const hasEmail = chance(0.8)
    const hasPhone = chance(0.7)
    const hasCompany = chance(0.85)
    const source = weightedPick(CONTACT_SOURCE_WEIGHTS)
    const isLine = source === 'LINE'
    const firstName = pick(FIRST_NAMES)
    const digits = pad(i, 7)
    const createdAt = new Date(BASE - int(0, 365) * DAY_MS)
    contacts.push({
      id: `cseedcont${pad(i, 5)}`,
      firstName,
      lastName: pick(LAST_NAMES),
      email: hasEmail ? `contact${pad(i, 5)}@example.com` : null,
      // Fake 000-prefixed range: not a valid Thai number, but matches the
      // ContactCreate phone regex /^[0-9+\- ]{6,20}$/ (lib/contracts/crm.ts).
      phone: hasPhone ? `000-${digits.slice(0, 3)}-${digits.slice(3)}` : null,
      lineUserId: isLine ? `U5eed${i.toString(16).padStart(28, '0')}` : null,
      lineDisplayName: isLine ? firstName : null,
      source,
      companyId: hasCompany ? pick(companies).id : null,
      ownerId: salesUserIds[(i - 1) % salesUserIds.length],
      createdAt,
      updatedAt: createdAt,
    })
  }
  return contacts
}

function buildLeads(contacts: ContactSeed[]): LeadSeed[] {
  const leads: LeadSeed[] = []
  for (let i = 1; i <= 400; i++) {
    // 7 and 2000 are coprime, so this maps 1..400 onto 400 distinct contacts.
    const contactIndex = ((i - 1) * 7) % 2000
    const contact = contacts[contactIndex]
    const isClosed = i > 300
    const stage = isClosed ? weightedPick(CLOSED_STAGE_WEIGHTS) : weightedPick(OPEN_STAGE_WEIGHTS)
    const lostReason = stage === 'LOST' ? pick(LOST_REASONS) : null
    const hasValue = chance(0.7)
    const hasScore = chance(0.5)
    const createdAt = new Date(BASE - int(1, 400) * DAY_MS)
    // createdAt <= stageChangedAt always holds: the offset below is >= 0.
    const stageChangedAt = new Date(createdAt.getTime() + int(0, 60) * DAY_MS)
    leads.push({
      id: `cseedlead${pad(i, 4)}`,
      title: `ดีลกับ ${contact.firstName} ${contact.lastName}`,
      stage,
      source: contact.source,
      value: hasValue ? int(5, 500) * 1000 : null,
      score: hasScore ? int(10, 95) : null,
      scoreUpdatedAt: hasScore ? stageChangedAt : null,
      lostReason,
      stageChangedAt,
      closedAt: isClosed ? stageChangedAt : null,
      contactId: contact.id,
      companyId: contact.companyId,
      ownerId: contact.ownerId,
      createdById: contact.ownerId,
      createdAt,
      updatedAt: stageChangedAt,
    })
  }
  return leads
}

function buildActivities(leads: LeadSeed[]): ActivitySeed[] {
  const activities: ActivitySeed[] = []
  leads.forEach((lead, index) => {
    activities.push({
      id: `cseedactc${pad(index + 1, 4)}`,
      leadId: lead.id,
      type: 'LEAD_CREATED',
      meta: { source: lead.source, seed: true },
      actorId: lead.ownerId,
      createdAt: lead.createdAt,
    })
  })
  let stageChangeCount = 0
  for (const lead of leads) {
    if (lead.stage === 'NEW') continue
    stageChangeCount += 1
    activities.push({
      id: `cseedacts${pad(stageChangeCount, 4)}`,
      leadId: lead.id,
      type: 'STAGE_CHANGED',
      meta: { from: 'NEW', to: lead.stage, reason: lead.lostReason ?? null },
      actorId: lead.ownerId,
      createdAt: lead.stageChangedAt,
    })
  }
  return activities
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

async function insertChunked<T>(
  label: string,
  rows: T[],
  insert: (chunk: T[]) => Promise<{ count: number }>,
): Promise<void> {
  let inserted = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const result = await insert(chunk)
    inserted += result.count
  }
  console.log(`${label}: inserted ${inserted} of ${rows.length} generated rows`)
}

async function main(): Promise<void> {
  const demoPassword = process.env.DEMO_PASSWORD
  if (!demoPassword) {
    console.error('DEMO_PASSWORD is not set')
    process.exitCode = 1
    return
  }

  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) {
    console.error('DIRECT_URL or DATABASE_URL is not set')
    process.exitCode = 1
    return
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 5000, max: 2 }),
  })

  try {
    console.log('Seeding users...')
    const users: { id: string; role: 'ADMIN' | 'SALES' }[] = []
    for (const seedUser of SEED_USERS) {
      // One hashPassword call per user (each gets its own random salt), even
      // though every seed account shares the same DEMO_PASSWORD.
      const passwordHash = await hashPassword(demoPassword)
      const user = await prisma.user.upsert({
        where: { email: seedUser.email },
        create: { email: seedUser.email, name: seedUser.name, role: seedUser.role, active: true, passwordHash },
        // DEMO_PASSWORD stays authoritative on a re-run.
        update: { name: seedUser.name, role: seedUser.role, active: true, passwordHash },
      })
      users.push({ id: user.id, role: user.role })
    }
    console.log(`Users upserted: ${users.length}`)

    const admin = users.find((u) => u.role === 'ADMIN')
    const salesUsers = users.filter((u) => u.role === 'SALES')
    if (!admin || salesUsers.length !== 5) {
      throw new Error('expected 1 admin and 5 sales users after upsert')
    }
    const salesUserIds = salesUsers.map((u) => u.id)

    console.log('Generating rows...')
    const companies = buildCompanies(admin.id)
    const contacts = buildContacts(companies, salesUserIds)
    const leads = buildLeads(contacts)
    const activities = buildActivities(leads)

    await insertChunked('Company', companies, (chunk) =>
      prisma.company.createMany({ data: chunk, skipDuplicates: true }),
    )
    await insertChunked('Contact', contacts, (chunk) =>
      prisma.contact.createMany({ data: chunk, skipDuplicates: true }),
    )
    await insertChunked('Lead', leads, (chunk) => prisma.lead.createMany({ data: chunk, skipDuplicates: true }))
    await insertChunked('Activity', activities, (chunk) =>
      prisma.activity.createMany({ data: chunk, skipDuplicates: true }),
    )

    const [companyCount, contactCount, leadCount, activityCount, userCount] = await Promise.all([
      prisma.company.count({ where: { id: { startsWith: 'cseed' } } }),
      prisma.contact.count({ where: { id: { startsWith: 'cseed' } } }),
      prisma.lead.count({ where: { id: { startsWith: 'cseed' } } }),
      prisma.activity.count({ where: { id: { startsWith: 'cseed' } } }),
      prisma.user.count({ where: { email: { endsWith: '@crm.test' } } }),
    ])
    console.log('Final seed counts:', { userCount, companyCount, contactCount, leadCount, activityCount })
  } catch (err) {
    // Never print the connection URL or the password: only the message.
    console.error('Seed failed:', err instanceof Error ? err.message : 'unknown error')
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

void main()
