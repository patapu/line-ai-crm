import { NextResponse } from 'next/server'
import { withRoute } from '@/lib/http'
import { requireUser } from '@/lib/auth/dal'

// [A] app/api/me/route.ts: see docs/design.md section 3's API table.
export const GET = withRoute('GET /api/me', async (req) => {
  const actor = await requireUser(req)
  return NextResponse.json({ user: { id: actor.id, name: actor.name, role: actor.role } })
})
