import 'server-only'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type Prisma } from '@/lib/generated/prisma/client'
import { getEnv } from '@/lib/env'

// [F] lib/db.ts: see docs/design.md section 1, 8 and 10.
//
// The `prisma-client` generator (output = ../lib/generated/prisma in
// schema.prisma) exposes `PrismaClient` and the `Prisma` namespace from
// `<output>/client`, i.e. `@/lib/generated/prisma/client`.
export type Db = PrismaClient
export type Tx = Prisma.TransactionClient

// Lazy globalThis singleton: constructing PrismaClient (and the adapter pool)
// must NOT happen at module import time. `next build` statically imports
// every route handler to collect routes, and that import chain reaches this
// module before any request is ever served: connecting (or throwing) here
// would break the build. Same pattern as an earlier project's Redis client.
const globalForDb = globalThis as unknown as { __crmDb?: PrismaClient }

export function getDb(): PrismaClient {
  if (!globalForDb.__crmDb) {
    const env = getEnv()
    const adapter = new PrismaPg({
      connectionString: env.DATABASE_URL,
      // Prisma 7's pg adapter does not default a connection timeout the way
      // Prisma 6 did (5s). Set it explicitly (see design section 10).
      connectionTimeoutMillis: 5000,
      // Neon's pooler already pools connections; keep this adapter's own pool
      // small per serverless instance (design section 8).
      max: 5,
    })
    globalForDb.__crmDb = new PrismaClient({ adapter })
  }
  return globalForDb.__crmDb
}
