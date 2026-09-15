import 'server-only'
import { z } from 'zod'

// [F] lib/env.ts: see docs/design.md section 8.
//
// Parsed LAZILY, on first call to getEnv(), never at module import time.
// `next build` statically imports every route handler to collect routes, so a
// top level `EnvSchema.parse(process.env)` here would throw during build
// before any request is served (same lesson as an earlier project's Redis client).

const DEV_ONLY_SESSION_SECRET = 'dev-only-session-secret-change-me-32bytes-min'

/** Treats an empty string the same as an unset variable, before `.optional()` runs. */
function optionalString() {
  return z.preprocess((v) => (v === '' ? undefined : v), z.string().optional())
}

const EnvSchema = z
  .object({
    // Connection (Neon: pooled for runtime, direct for migrate, see section 8/10)
    DATABASE_URL: z.string().min(1),
    DIRECT_URL: z.string().min(1),

    // Auth
    SESSION_SECRET: z.string().min(32),
    APP_URL: z.url(),

    // Copilot (Gemini via @ai-sdk/google). API key is optional: unset key means
    // the wrapper falls back to the rule based suggestion (see contracts/copilot.ts).
    GOOGLE_GENERATIVE_AI_API_KEY: optionalString(),
    COPILOT_MODEL: z.string().default('gemini-flash-latest'),
    COPILOT_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
    COPILOT_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.5),

    // LINE Messaging API
    LINE_MODE: z.enum(['mock', 'live']).default('mock'),
    LINE_CHANNEL_SECRET: optionalString(),
    LINE_CHANNEL_ACCESS_TOKEN: optionalString(),
    LINE_INBOUND_OWNER_EMAIL: optionalString(),

    // Ops
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    // Seed only, never read outside prisma/seed.ts
    DEMO_PASSWORD: optionalString(),
  })
  .superRefine((env, ctx) => {
    if (env.LINE_MODE === 'live' && (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN)) {
      ctx.addIssue({
        code: 'custom',
        path: ['LINE_MODE'],
        message: 'LINE_MODE=live requires both LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN',
      })
    }
    if (process.env.NODE_ENV === 'production' && env.SESSION_SECRET === DEV_ONLY_SESSION_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'SESSION_SECRET must not be the .env.example placeholder in production',
      })
    }
  })

export type Env = z.infer<typeof EnvSchema>

let cached: Env | null = null

/**
 * Lazy, memoized Zod parse of process.env. Throws only when actually called.
 * On failure, catches the ZodError and rethrows a plain Error that names
 * only the invalid key names (never values), so lib/http.ts's withRoute maps
 * it onto a 500 INTERNAL instead of a 400 that would name server env keys to
 * the client.
 */
export function getEnv(): Env {
  if (!cached) {
    try {
      cached = EnvSchema.parse(process.env)
    } catch (err) {
      if (err instanceof z.ZodError) {
        const keyNames = [...new Set(err.issues.map((issue) => String(issue.path[0] ?? 'unknown')))]
        throw new Error('Invalid server environment: ' + keyNames.join(', '))
      }
      throw err
    }
  }
  return cached
}
