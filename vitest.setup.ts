// [F] vitest.setup.ts: test env defaults.
//
// Set BEFORE any test module imports lib/env.ts, so a lazy getEnv() call
// anywhere in the import graph (auth, http, db) resolves without throwing.
// None of these are real secrets. Lane D's DB-backed tests override
// DATABASE_URL / DIRECT_URL to point at the test Postgres instance.

process.env.DATABASE_URL ??= 'postgresql://crm:crm@localhost:5432/crm_test'
process.env.DIRECT_URL ??= 'postgresql://crm:crm@localhost:5432/crm_test'
process.env.SESSION_SECRET ??= 'test-session-secret-please-change-32bytes'
process.env.APP_URL ??= 'http://localhost:3000'
process.env.COPILOT_MODEL ??= 'gemini-flash-latest'
process.env.COPILOT_TIMEOUT_MS ??= '8000'
process.env.COPILOT_MIN_CONFIDENCE ??= '0.5'
process.env.LINE_MODE ??= 'mock'
process.env.LOG_LEVEL ??= 'info'
process.env.DEMO_PASSWORD ??= 'test-demo-password'
