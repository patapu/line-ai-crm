// OWNER: lane A — Server Component
//
// Reads searchParams itself (never a client useSearchParams) and passes a
// sanitized `next` to the client LoginForm.
import type { Metadata } from 'next'
import { LoginForm } from '@/components/crm/LoginForm'
import { safeNext } from '@/components/crm/safe-next'

export const metadata: Metadata = { title: 'เข้าสู่ระบบ' }

export default async function LoginPage(props: PageProps<'/login'>) {
  const sp = await props.searchParams
  const raw = sp.next
  const rawNext = Array.isArray(raw) ? raw[0] : raw
  const next = safeNext(rawNext)

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface bg-brand-wash p-6">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-card border border-line bg-white p-6">
        <div>
          <h1 className="text-2xl font-bold text-primary">LINE AI CRM</h1>
          <p className="text-sm text-muted">เข้าสู่ระบบเพื่อใช้งาน</p>
        </div>
        <LoginForm next={next} />
      </div>
    </div>
  )
}
