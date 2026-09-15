// OWNER: lane A — server component, no JS
import Link from 'next/link'
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

export function LeadFilters({ values, users, companies }: LeadFiltersProps) {
  return (
    <form
      method="get"
      action="/leads"
      className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6"
    >
      <Field label="ค้นหา" htmlFor="q">
        <Input id="q" name="q" defaultValue={values.q ?? ''} placeholder="ชื่อ, บริษัท, อีเมล" />
      </Field>
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
      <div className="col-span-full flex items-center gap-3">
        <Button type="submit">กรอง</Button>
        <Link href="/leads" className="text-sm text-slate-500 hover:underline">
          Reset
        </Link>
      </div>
    </form>
  )
}
