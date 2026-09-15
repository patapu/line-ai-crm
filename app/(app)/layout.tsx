// OWNER: lane A — Server Component
//
// Every page under (app) also calls getActor()/verifySession() itself: the
// layout's auth check does not re-run on client navigation (Partial
// Rendering), so this alone is not a per-page gate, only the shell.
import { verifySession } from '@/lib/auth/dal'
import { getEnv } from '@/lib/env'
import { NavBar } from '@/components/crm/NavBar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await verifySession()

  return (
    <>
      <NavBar name={session.name} role={session.role} />
      {getEnv().LINE_MODE === 'mock' ? (
        <div className="bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
          LINE mock mode: ข้อความ LINE ทั้งหมดจำลองการทำงาน ไม่ได้ส่งจริง
        </div>
      ) : null}
      <main className="mx-auto max-w-7xl p-4">{children}</main>
    </>
  )
}
