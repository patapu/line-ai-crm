# Lane task index

Read `AGENTS.md` at the repo root first, then `docs/design.md` in full, then the lane brief
you are running. This file is the map across all five lanes.

## Lane table

| Lane | Scope | Branch | Depends on | Estimated hours |
|---|---|---|---|---|
| Layer 0 | Frozen contracts: schema, DTOs, service signatures, auth, log/http/error helpers | (done before lanes start) | none | 2 |
| A: CRM | Website, CRM API routes, CRM service/repository bodies, seed data, `proxy.ts` | `lane-a-crm` | Layer 0 | 5 |
| B: Copilot | AI copilot module, `SKILL.md`, evals, insights/suggestions routes, `InsightPanel` | `lane-b-copilot` | Layer 0 | 3 |
| C: LINE | LINE signature/client/webhook, messages/retry/simulate routes, message components | `lane-c-line` | Layer 0 | 3 |
| D: Tests/infra | The 3 core automated tests, CI, Docker/compose, Vercel build script | `lane-d-tests-infra` | Layer 0 (code from A/B/C for green tests) | 1.5 |
| E: Docs | README, architecture diagram, API notes, decisions, AI usage log skeleton | `lane-e-docs` | Layer 0 (design.md); mostly independent of A/B/C | 1.5 |

Hours are the rough plan from `docs/design.md`'s risk section, out of a 16-hour timebox. If
the total is running over, cut in this order (also from `docs/design.md`):

1. Tags (Lane A: `Tag` model UI, `tagIds` on contacts)
2. Company UI (Lane A)
3. Simulate UI polish (Lane C: the `/api/dev/line/simulate` route itself stays, drop extra UI around it)
4. Live eval run against real Gemini (Lane B: `npm run eval:copilot` can be skipped if time is short; the eval cases and script still ship)

## The layer 0 gate

Nothing in lanes A through E starts until layer 0 passes its gate, because every lane
imports the same schema, DTOs, and service signatures. The gate (`docs/design.md`, plan step
2) is:

1. `npm install`, `npx prisma validate`
2. `npx prisma migrate dev --name init`, then a second `npx prisma migrate dev --name
   check_constraints` for the CHECK constraint SQL, since it cannot be expressed in
   `schema.prisma`
3. Confirm the CHECK constraints survive a fresh `prisma migrate deploy` against an empty
   database. `prisma migrate reset` needs explicit human consent (Prisma's own AI safety
   guard blocks it otherwise), so a fresh empty database stands in for a reset in an agent
   session
4. `npx next typegen`, `npx tsc --noEmit`, `npm run lint`

`prisma/migrations/` therefore holds two migrations, not one: `*_init` and
`*_check_constraints`. See `docs/design.md` section 10 for why.

## Merge order and integration

Pakorn is the integration owner. Recommended merge order, matching the dependency shape in
`docs/design.md` section 1 (`crm` cannot import `line` or `copilot`; `line` can import
`crm`; `copilot` can import `crm` and `line`):

1. `lane-a-crm` merges first: it owns the pages that mount both B's and C's components, and
   the CRM service that C's webhook calls into.
2. `lane-c-line` merges next: the LINE module, so the approval flow in B has something real
   to send through.
3. `lane-b-copilot` merges last of the three feature lanes. The approval flow joins B and C
   through A's UI (the lead detail page mounts `InsightPanel` from B and `Composer` /
   `MessageBubble` from C side by side), so it is easiest to verify once both are in.
4. `lane-d-tests-infra` and `lane-e-docs` can merge whenever their own work is ready; they
   don't block or get blocked by A/B/C code, but Lane D's three tests only go fully green
   once A, B, and C have landed real bodies.

After all five are merged, integration (`docs/design.md` plan step 8) runs the full CI
suite locally, `npm run eval:copilot` against real Gemini, and a smoke test through the
simulate route. If an eval case fails, the fix goes into `skills/crm-copilot/instructions.md`.
Never loosen the eval's pass bar to make it pass.

## Review checkpoints

Review happens in three batches rather than continuously, so lane sessions aren't blocked
waiting on line-by-line feedback:

1. **Layer 0 gate** (`docs/design.md` plan step 2): confirms the frozen contract itself is
   sound (schema validates, migration and CHECK constraints survive reset, typecheck and
   lint are clean) before any lane starts building on top of it.
2. **Integration** (`docs/design.md` plan step 8): after all five lanes merge, confirms the
   whole system works together with full CI, the live eval run, and a webhook smoke test.
3. **Review** (`docs/design.md` plan step 9): a focused pass on the assignment's security
   and correctness-sensitive spots, specifically raw body reading and HMAC verification,
   that retries reuse the same `retryKey`, that AI suggestions stay separate from confirmed
   writes, and that nothing logs a secret.
