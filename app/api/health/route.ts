import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { withRoute } from '@/lib/http'
import { DomainError } from '@/lib/errors'

export const runtime = 'nodejs'

// [F] app/api/health/route.ts: implemented for real in layer 0 (task
// instructions). See docs/design.md section 3's API table
// (`GET /api/health public A SELECT 1, no secrets`) and section 5's
// "DB ล่มฝั่ง UI ตอบ error envelope 503": a failed SELECT 1 is mapped to
// UPSTREAM_UNAVAILABLE (503), not a generic 500.
export const GET = withRoute(
  'GET /api/health',
  async () => {
    try {
      await getDb().$queryRaw`SELECT 1`
    } catch (err) {
      throw new DomainError('UPSTREAM_UNAVAILABLE', 'database unavailable', undefined, { cause: err })
    }
    return NextResponse.json({ status: 'ok' })
  },
  { public: true },
)
