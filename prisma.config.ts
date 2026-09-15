import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

// [F] prisma.config.ts: Prisma 7 config file. See docs/design.md section 10
// (this section overrides section 1/8 wherever they conflict).
//
// - Prisma 7 dropped `url` from the `datasource` block in schema.prisma; the
//   migrate/introspect URL now lives here instead.
// - Migrate uses DIRECT_URL (no pooler): migration commands need a real
//   session, which Neon's pooled connection (PgBouncer, transaction mode)
//   cannot give them. Runtime queries use DATABASE_URL (pooled) via
//   lib/db.ts's PrismaPg adapter instead.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // `tsx` alone resolves the default (browser/node) export condition, which
    // trips the `server-only` import in lib modules the seed script pulls in.
    // `--conditions=react-server` makes it resolve the same way Next's server
    // bundler would, so `server-only` sees the condition it expects.
    seed: 'tsx --conditions=react-server prisma/seed.ts',
  },
  datasource: { url: env('DIRECT_URL') },
})
