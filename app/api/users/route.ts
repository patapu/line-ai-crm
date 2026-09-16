import { NextResponse } from 'next/server'
import { withRoute } from '@/lib/http'
import { requireUser } from '@/lib/auth/dal'
import { listUsers } from '@/modules/crm/service'

// [A] app/api/users/route.ts: see docs/design.md section 3's API table.
// Owner dropdown list for lead/contact forms: id + name + role of active users.
export const GET = withRoute('GET /api/users', async (req) => {
  await requireUser(req)
  return NextResponse.json({ items: await listUsers() })
})
