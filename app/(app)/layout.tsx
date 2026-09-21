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
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:text-primary focus-visible:outline-white"
      >
        ข้ามไปยังเนื้อหาหลัก
      </a>
      <NavBar name={session.name} role={session.role} />
      {getEnv().LINE_MODE === 'mock' ? (
        <div className="bg-warning-soft px-4 py-2 text-center text-sm text-warning">
          LINE mock mode: ข้อความ LINE ทั้งหมดจำลองการทำงาน ไม่ได้ส่งจริง
        </div>
      ) : null}
      <main id="main" tabIndex={-1} className="mx-auto max-w-7xl p-4 focus:outline-none">
        {children}
      </main>
    </>
  )
}
