# Lane D: Tests and infra

## Goal

Prove the three risky behaviors with real automated tests against a real Postgres, wire up
CI, and get the app deployable both on Vercel/Neon and via Docker Compose.

## Brief section it serves

Automated tests for one core CRM flow, one AI skill behavior/fallback, and one LINE webhook
security/idempotency flow, plus structured logging and monitoring notes. Also underpins the
deploy evidence for the whole project.

## Owned files

From `docs/design.md` section 1, exactly:

```
scripts/vercel-build.mjs
tests/helpers/db.ts, tests/helpers/auth.ts, tests/helpers/line.ts
tests/crm-flow.test.ts
tests/copilot-fallback.test.ts
tests/line-webhook.test.ts
vercel.json
Dockerfile
docker-compose.yml
.github/workflows/ci.yml
```

`tests/smoke.test.ts` and `tests/security.test.ts` already exist from layer 0 and are
frozen; this lane does not own or edit them, but may add its own new test files anywhere
under `tests/`.

## Frozen files (do not touch)

The full frozen list is in `AGENTS.md`. This lane reads from nearly all of them (contracts,
service signatures, schema) but writes to none of them. If a test reveals that a frozen
signature is wrong or missing something you need, don't edit it. Write up
`docs/contract-change-requests.md` and escalate to Pakorn.

## Contracts to import

This lane imports whatever the module under test imports, plus test-only helpers:

- `modules/crm/service.ts` (`changeStage`), `lib/db.ts` (`Db`, `Tx`, `getDb`) for the CRM
  flow test
- `modules/copilot/fallback.ts` (`suggestWithFallback`) and `modules/copilot/types.ts` for
  the copilot fallback test
- `modules/line/service.ts` (`handleLineWebhook`), `modules/line/client.mock.ts`
  (`MockLineClient`) for the webhook test
- `lib/auth/dal.ts` (`Actor`) to build test actors in `tests/helpers/auth.ts`
- `lib/contracts/*` as needed for building valid request bodies

## Step-by-step tasks

Drawn from `docs/design.md` plan steps 2 (gate, already done before lanes start), 6, and the
Vercel/Neon section 8.

1. Build `tests/helpers/db.ts`: connect to a real Postgres (local or compose), truncate
   relevant tables between tests. Build `tests/helpers/auth.ts`: construct test `Actor`
   values and seeded test users. Build `tests/helpers/line.ts`: construct a fresh
   `MockLineClient` and signed webhook payloads for tests. `vitest.config.ts` already sets
   `fileParallelism: false`, because these DB-backed tests all share one Postgres; do not
   remove it and do not add a `--pool` flag that reintroduces parallel file runs.
2. Write `tests/crm-flow.test.ts`, the three scenarios below (from `docs/design.md` plan
   step 6), against a real database, calling `changeStage` directly the same way a route
   handler test would call `POST(req)`.
3. Write `tests/copilot-fallback.test.ts`, the three scenarios below, calling
   `suggestWithFallback` directly with an injected `copilot` dependency that throws, hangs,
   or returns a low-confidence result.
4. Write `tests/line-webhook.test.ts`, the four scenarios below, calling
   `handleLineWebhook` with a `MockLineClient` built via `tests/helpers/line.ts`.
5. Write `.github/workflows/ci.yml`: a Postgres service container, then
   `npx prisma validate`, `prisma generate`, `prisma migrate deploy`, `next typegen`,
   `tsc --noEmit`, `npm run lint`, `npm test`. No AI API key in CI. `LINE_MODE=mock`.
6. Write `scripts/vercel-build.mjs`: always run `prisma generate`; run
   `prisma migrate deploy` (with `DIRECT_URL`) only when `VERCEL_ENV === 'production'`; then
   `next build`.
7. Write `vercel.json` (`regions: ["sin1"]`, matching Neon's `aws-ap-southeast-1` region;
   confirm this against the actual Neon project once it exists), `Dockerfile` (multi-stage,
   `node:22-alpine` base, `NEXT_OUTPUT=standalone`, copies `skills/`, has a `migrate` target
   with the Prisma CLI), and `docker-compose.yml` (`db`: `postgres:16-alpine` with a
   `pg_isready` healthcheck, its port bound to `127.0.0.1:5432` only, a one-shot `migrate`
   service, and `app`).

## Acceptance criteria

The three test scenarios, exactly as specified in `docs/design.md`'s plan step 6 (this list
is authoritative: do not weaken any of these assertions):

**`tests/crm-flow.test.ts`**
- [ ] Moving a lead's stage forward then back produces exactly 2 `Activity` rows, each with
      the correct `from` and `to`
- [ ] Moving a lead to `LOST` without a `reason` returns `400`

**`tests/copilot-fallback.test.ts`**
- [ ] When the injected copilot dependency throws, hangs (times out), or returns a
      low-confidence result, all three cases produce `source: FALLBACK` and
      `lowConfidence: true`
- [ ] An `AiSuggestion` row is created in every case
- [ ] No `Message` row is created in any case

**`tests/line-webhook.test.ts`**
- [ ] A request with a wrong signature returns `401`
- [ ] A request with a tampered body (signature computed on different bytes than what's
      sent) returns `401`
- [ ] A duplicate delivery (same `webhookEventId` sent twice) returns `200` on both, and the
      row count in the database does not change between the two calls
- [ ] Retry reuses the exact same `retryKey` as the original send

Infra:

- [ ] `.github/workflows/ci.yml` runs all checks green against a Postgres service container,
      with no AI key and `LINE_MODE=mock`
- [ ] `docker compose up db` plus the quick start in the root `README.md` works from a clean
      checkout
- [ ] `npm run typecheck`, `npm run lint`, `npm test` all pass locally and in CI

## What to stub or mock while other lanes are unfinished

Write all three test files against the frozen signatures as soon as layer 0 lands. They
are useful as contract tests even before the real bodies exist (a test calling
`changeStage` will get `DomainError('INTERNAL', 'not implemented')` until Lane A finishes,
and that's expected, not a bug in your test). Track which tests are still failing because a
body isn't implemented yet versus because your test itself is wrong. All three tests are
only required to be fully green at the integration step (`docs/design.md` plan step 8),
after Lanes A, B, and C have merged real bodies.

## Handoff notes

Hand off to integration: three test files passing green against real Lane A/B/C code, a
working `ci.yml`, and a `docker compose up` that reproduces the app locally.
`scripts/vercel-build.mjs` and `vercel.json` are what the deploy step (`docs/design.md` plan
step 10) actually runs. Make sure they match section 8's Vercel/Neon plan, including the
`VERCEL_ENV` guard on migrations.

## Cut list if time runs short

`docs/design.md`'s risk section priority list (tags, company UI, simulate UI, live eval)
belongs to other lanes, not this one. The three tests and CI are required, not optional,
for handoff. If the 1.5-hour budget is genuinely too tight, the Dockerfile/
docker-compose portability path can slip after the Vercel deploy path, since Vercel/Neon is
the primary deploy target per `docs/design.md`'s opening paragraph.

## Opening prompt

```
Read AGENTS.md and docs/tasks/lane-D.md, then read docs/design.md plan step 6 (the three
test scenarios) and section 8 (Vercel and Neon) in full. Start with tests/helpers, then
write the three test files against the frozen module signatures, then ci.yml, then
vercel-build.mjs, vercel.json, Dockerfile and docker-compose.yml.
```
