// OWNER: lane A — Server Component
//
// Reads searchParams itself (never a client useSearchParams) and passes a
// sanitized `next` to the client LoginForm.
import { LoginForm } from '@/components/crm/LoginForm'
import { safeNext } from '@/components/crm/safe-next'

export default async function LoginPage(props: PageProps<'/login'>) {
  const sp = await props.searchParams
  const raw = sp.next
  const rawNext = Array.isArray(raw) ? raw[0] : raw
  const next = safeNext(rawNext)

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">LINE AI CRM</h1>
        <p className="text-sm text-slate-500">เข้าสู่ระบบเพื่อใช้งาน</p>
      </div>
      <LoginForm next={next} />
    </div>
  )
}
