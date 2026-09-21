// OWNER: lane A — server component, no JS
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { SOURCES, SOURCE_LABEL, STAGES, STAGE_LABEL } from '@/components/crm/constants'
import type { CompanyOption, UserOption } from '@/modules/crm/repository'

export interface LeadFiltersProps {
  values: Record<string, string>
  users: UserOption[]
  companies: CompanyOption[]
}

export const LEAD_FILTER_KEYS = ['q', 'stage', 'ownerId', 'source', 'companyId', 'open'] as const
export type LeadFilterKey = (typeof LEAD_FILTER_KEYS)[number]

/** number of LEAD_FILTER_KEYS whose value is non-empty after trim(); sort/dir NOT counted */
export function countActiveLeadFilters(values: Record<string, string>): number {
  return LEAD_FILTER_KEYS.reduce((count, key) => (values[key]?.trim() ? count + 1 : count), 0)
}

/** true when sort is set and !== 'updatedAt', or dir is set and !== 'desc' */
export function isLeadSortCustom(values: Record<string, string>): boolean {
  const sort = values.sort?.trim()
  const dir = values.dir?.trim()
  return (!!sort && sort !== 'updatedAt') || (!!dir && dir !== 'desc')
}

export function LeadFilters({ values, users, companies }: LeadFiltersProps) {
  const activeCount = countActiveLeadFilters(values)
  const open = activeCount > 0 || isLeadSortCustom(values)

  return (
    <details open={open} className="group rounded-card border border-line bg-white">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-card px-4 py-2 text-sm font-semibold text-primary-2 hover:bg-primary-soft group-open:rounded-b-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
        <span>ตัวกรอง</span>
        {activeCount > 0 && <Badge tone="blue">ใช้อยู่ {activeCount}</Badge>}
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="ml-auto size-5 shrink-0 group-open:rotate-180">
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </summary>
      <form
        method="get"
        action="/leads"
        className="grid grid-cols-1 gap-3 border-t border-line p-4 min-[340px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
      >
        <div className="col-span-full sm:col-span-1">
          <Field label="ค้นหา" htmlFor="q">
            <Input id="q" name="q" defaultValue={values.q ?? ''} placeholder="ชื่อ, บริษัท, อีเมล" />
          </Field>
        </div>
        <Field label="Stage" htmlFor="stage">
          <Select id="stage" name="stage" defaultValue={values.stage ?? ''}>
            <option value="">ทั้งหมด</option>
            {STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_LABEL[stage]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="เจ้าของ" htmlFor="ownerId">
          <Select id="ownerId" name="ownerId" defaultValue={values.ownerId ?? ''}>
            <option value="">ทั้งหมด</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ที่มา" htmlFor="source">
          <Select id="source" name="source" defaultValue={values.source ?? ''}>
            <option value="">ทั้งหมด</option>
            {SOURCES.map((source) => (
              <option key={source} value={source}>
                {SOURCE_LABEL[source]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="บริษัท" htmlFor="companyId">
          <Select id="companyId" name="companyId" defaultValue={values.companyId ?? ''}>
            <option value="">ทั้งหมด</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="สถานะ" htmlFor="open">
          <Select id="open" name="open" defaultValue={values.open ?? ''}>
            <option value="">ทั้งหมด</option>
            <option value="true">เปิดอยู่</option>
            <option value="false">ปิดแล้ว</option>
          </Select>
        </Field>
        <Field label="เรียงตาม" htmlFor="sort">
          <Select id="sort" name="sort" defaultValue={values.sort ?? 'updatedAt'}>
            <option value="updatedAt">อัปเดตล่าสุด</option>
            <option value="createdAt">วันที่สร้าง</option>
            <option value="value">มูลค่า</option>
            <option value="stageChangedAt">เปลี่ยน stage ล่าสุด</option>
          </Select>
        </Field>
        <Field label="ทิศทาง" htmlFor="dir">
          <Select id="dir" name="dir" defaultValue={values.dir ?? 'desc'}>
            <option value="desc">มาก-น้อย</option>
            <option value="asc">น้อย-มาก</option>
          </Select>
        </Field>
        <div className="col-span-full flex flex-wrap items-center gap-3">
          <Button type="submit">กรอง</Button>
          <Link href="/leads" className="text-sm font-semibold text-primary-2 hover:underline">
            ล้างตัวกรอง
          </Link>
        </div>
      </form>
    </details>
  )
}
