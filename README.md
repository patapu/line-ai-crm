# line-ai-crm

AI CRM MVP for a 20-person commercial team: leads, contacts, companies, and a pipeline
board, with an AI copilot for lead summaries/scores/next-best actions and a LINE Official
Account integration for chatting with leads without losing the audit trail.

Built as a take home assignment for a Lead AI Software Engineer role.

## Stack

- Next.js 16.3.5 (App Router), React 19
- TypeScript, Zod 4 for shared contracts
- Prisma 7.10.0 on PostgreSQL
- `ai` v7 with `@ai-sdk/google` (Gemini) for the AI copilot
- LINE Messaging API for the LINE OA integration
- Vitest for automated tests
- Target deploy: Vercel (app) + Neon (database), region `sin1`

See `docs/design.md` for the full contract: schema, API table, module boundaries, and the
reasoning behind these choices.

## Status

Layer 0 scaffold complete. Lanes A to E not started.

## Known limitations

`npm audit` reports 4 high findings, all in the Prisma CLI's dev only tooling (`mysql2` and
`deepmerge-ts`, pulled in through `@prisma/config`). The only suggested fix is a downgrade
to Prisma 6, which this project does not take. The app's own runtime uses `pg` with
`@prisma/adapter-pg`, not `mysql2`.

## Local quick start

1. `docker compose up -d db`
2. `npm install`
3. `cp .env.example .env` (Prisma's config reads `.env` through `dotenv`, so use `.env`,
   not `.env.local`)
4. `npm run db:generate`
5. `npm run db:migrate`
6. `npm run dev`

Also available: `npm run typecheck`, `npm run lint`, and `npm test`.

Fill in `.env` with real values before running `npm run dev`. See `.env.example` for the
full list of variables and what each one is for. `LINE_MODE=mock` lets you run the app and
exercise the LINE flow without a real LINE Official Account.

## Docs

- [`docs/design.md`](docs/design.md): the layer 0 contract, covering schema, API table,
  TypeScript interfaces, request flows, auth, logging, and the Vercel/Neon deploy plan.
  Section 10 overrides earlier sections where they disagree.
- [`docs/tasks/README.md`](docs/tasks/README.md): the lane index, covering what each lane
  owns, dependencies, estimated hours, and the review checkpoints.

## TODO (Lane E)

The sections below are placeholders. Fill them in as the corresponding lane finishes.

### Deploy

TODO: Vercel project URL, Neon project/region, how to reproduce the deploy from a clean
checkout, environment variables that must be set on Vercel vs. locally.

### Demo accounts

TODO: seeded demo user emails and how to get the password (`DEMO_PASSWORD` at seed time),
which account is admin vs. sales, and what each one can see.

### LINE OA test instructions

TODO: how to add the test LINE Official Account as a friend (QR code or LINE ID), what
`LINE_MODE=mock` vs `LINE_MODE=live` means for a reviewer, and how to trigger a webhook
event manually via `/api/dev/line/simulate`.

### Architecture diagram

TODO: mermaid diagram of the request flow (website -> API -> service layer -> Prisma ->
Postgres, plus the LINE webhook path and the Gemini call path). See `docs/architecture.md`.

### Trade-offs

TODO: link to or summarize `docs/decisions.md`, covering why route handlers instead of
server actions, why webhook processing is synchronous instead of a queue, why retries are
in-request plus manual instead of a background worker, and why `adapter-pg` instead of
`adapter-neon`.

### Limitations

TODO: what is out of scope for the MVP (see the cut list in `docs/tasks/README.md`), what is
UNVERIFIED in `docs/design.md` (PgBouncer + prepared statements, Vercel time limits), and the
in-memory login rate limit's limits.
