# Lane A: CRM

## Goal

Build the CRM website and API: login, the pipeline board, lead/contact/company management,
search and filter, the lead detail page with activity and message timeline, and the seed
data the rest of the demo runs on.

## Brief section it serves

The working AI CRM product itself: a responsive website, working API and relational
database, and a working deploy that survives refresh/restart.

## Owned files

From `docs/design.md` section 1, exactly:

```
app/layout.tsx, app/globals.css
app/(auth)/login/page.tsx
app/(app)/layout.tsx
app/(app)/page.tsx
app/(app)/leads/page.tsx, app/(app)/leads/new/page.tsx
app/(app)/leads/[id]/page.tsx
app/(app)/contacts/**, app/(app)/companies/**
app/api/auth/login, app/api/auth/logout, app/api/me, app/api/health, app/api/users
app/api/leads/route.ts, app/api/leads/[id]/route.ts
app/api/leads/[id]/stage, app/api/leads/[id]/timeline, app/api/leads/[id]/activities
app/api/contacts/**, app/api/companies/**
components/ui/**, components/crm/**
modules/crm/service.ts   (bodies only; signatures are frozen, see below)
modules/crm/repository.ts
prisma/seed.ts
proxy.ts
```

Plus any new file you create inside folders you already own above (for example a new
component under `components/crm/`).

## Frozen files (do not touch)

The full frozen list is in `AGENTS.md`. The ones most relevant to this lane:

- `modules/crm/types.ts`: fully frozen
- `modules/crm/service.ts`: the function **signatures** are frozen (see `docs/design.md`
  section 4). You implement the bodies; do not change a function's name, parameters, or
  return type.
- `lib/contracts/crm.ts`, `lib/contracts/common.ts`, `lib/contracts/timeline.ts`
- `lib/db.ts`, `lib/errors.ts`, `lib/http.ts`, `lib/auth/session.ts`, `lib/auth/dal.ts`,
  `lib/auth/password.ts`
- `modules/audit/activity.ts` (already implemented in layer 0)
- `prisma/schema.prisma`, `prisma.config.ts`, `next.config.ts`

If any of these need to change, do not edit them. Write up
`docs/contract-change-requests.md` and escalate to Pakorn.

## Contracts to import

From `lib/contracts/crm.ts`: `LeadStageSchema`, `LeadSourceSchema`, `LeadListQuery`,
`LeadCreate`, `LeadUpdate`, `StageChange`, `ContactCreate`, `ContactUpdate`,
`ContactListQuery`, `CompanyCreate`, `CompanyUpdate`, `ActivityCreate`, `LoginInput`.

From `lib/contracts/common.ts`: `IdSchema`, `PageQuery`, `ErrorCode`, `ApiErrorBody`, the
`Paged<T>` type.

From `lib/contracts/timeline.ts`: `TimelineQuery`, `TimelineItem`, `TimelinePage`.

From `modules/crm/types.ts` and `modules/crm/service.ts` (frozen signatures you implement):
`changeStage`, `createLead`, `listLeads`, `getLeadDetail`, `getLeadTimeline`,
`findOrCreateContactByLineUserId`, `findOrOpenLeadForContact`.

From `modules/audit/activity.ts`: `writeActivity`.

From `lib/auth/dal.ts`: the `Actor` type, `canActOnLead`. From `lib/db.ts`: `Db`, `Tx`,
`getDb`. From `lib/errors.ts`: `DomainError`. From `lib/http.ts`: `withRoute`.

## Step-by-step tasks

Drawn from `docs/design.md` sections 5B (approval flow context only), 6, and plan step 3.

1. Implement `modules/crm/service.ts` bodies against the frozen signatures:
   - `changeStage`: single `$transaction`. Same stage in -> `{ changed: false }`, no
     `Activity` row. Otherwise check `canActOnLead` (else `FORBIDDEN`), `updateMany` on
     `{ id, stage: from }` (count 0 -> `CONFLICT`), set `stageChangedAt`, `closedAt` on
     `WON`/`LOST` (else `null`), `lostReason`, then `writeActivity` with type
     `STAGE_CHANGED` and `meta: { from, to, reason }`.
   - `createLead`, `listLeads`, `getLeadDetail`, `getLeadTimeline` against the query/DTO
     shapes above.
   - `findOrCreateContactByLineUserId`, `findOrOpenLeadForContact` exist so Lane C's
     webhook can call into CRM (`line` is allowed to import `crm`). `findOrOpenLeadForContact`
     reuses the latest lead that isn't `WON`/`LOST` for that contact, else opens a new one at
     `NEW`.
   - `modules/crm/repository.ts` holds the actual Prisma queries; keep `service.ts` as the
     orchestration layer that calls into it.
2. Implement the auth pages/routes: `app/(auth)/login/page.tsx` (client form posting JSON),
   `app/api/auth/login`, `app/api/auth/logout`, `app/api/me`, `app/api/health` (plain
   `SELECT 1`, no secrets in the response), `app/api/users` (owner dropdown).
3. Implement `app/(app)/layout.tsx` calling `verifySession()` and rendering nav; remember
   this is the layer that redirects to `/login` when the session is missing or invalid.
4. Implement lead routes: list/create (`GET|POST /api/leads`), detail/update
   (`GET|PATCH /api/leads/[id]`, `ownerId` reassignment admin-only, writes `OWNER_CHANGED`),
   stage change (`POST /api/leads/[id]/stage`), timeline (`GET /api/leads/[id]/timeline`,
   cursor-based), activities (`POST /api/leads/[id]/activities`, types `NOTE`/`CALL`/
   `MEETING`/`EMAIL` only).
5. Implement contacts and companies CRUD. `DELETE` on a contact or company that is still
   linked to a lead returns `409`, not a hard delete. Leads themselves cannot be deleted in
   this version. Moving to `LOST` is the only way to close one.
6. Build the pages: pipeline board (`(app)/page.tsx`), lead list with search/filter
   (`leads/page.tsx`), new lead (`leads/new/page.tsx`), lead detail with timeline
   (`leads/[id]/page.tsx`, this page also mounts Lane B's `InsightPanel` and Lane C's
   `Composer`/`MessageBubble`, and reads `hasLine` off `LeadDetail.contact` to decide
   whether `Composer` can send), contacts and companies pages. Delete the placeholder
   `app/page.tsx` when you add `app/(app)/page.tsx`, or the build fails on a duplicate `/`
   route.
7. Write `proxy.ts`: optimistic redirect to `/login` when the session cookie is missing or
   fails to decrypt. The matcher must not cover `/api`, `_next`, or static files. This is a
   redirect convenience only, not the real auth check (route handlers and Server Components
   check the session themselves).
8. Write `prisma/seed.ts`: 6 users, 150 companies, 2,000 contacts, 300 open leads, 100 closed
   leads. Use synthetic Thai names generated from a fixed PRNG seed so the seed is
   reproducible. Seed accounts: `admin@crm.test` and `sales1@crm.test` through
   `sales5@crm.test`, password from `DEMO_PASSWORD`.
9. Remember `params` and `searchParams` are async in every route and page. `await` them
   everywhere, per the Next.js 16 warning in `AGENTS.md`.

## Acceptance criteria

- [ ] Login works with a seeded demo account and sets the `crm_session` cookie
- [ ] Pipeline board shows leads grouped by stage
- [ ] Lead list supports search (`q`), filter by stage/owner/source/company, and the `open`
      flag (stage not `WON`/`LOST`)
- [ ] Lead detail page shows contact/company info, merged activity + message timeline, and
      mounts `InsightPanel` and `Composer`/`MessageBubble`
- [ ] Stage change writes exactly one `Activity` row with correct `from`/`to`, and moving to
      `LOST` without a `reason` returns `400`
- [ ] Moving a lead to the stage it is already in returns `changed: false` with no new
      `Activity` row
- [ ] Only the lead's owner or an admin can edit it, change its stage, or reassign its owner
- [ ] Contact/company `DELETE` returns `409` when the record still has leads attached
- [ ] `GET /api/health` returns `200` with no secrets in the body
- [ ] Seed produces the volumes above and is reproducible (same seed, same data)
- [ ] `npm run typecheck`, `npm run lint`, `npm test` all pass

## What to stub or mock while other lanes are unfinished

`docs/design.md` does not specify exactly how the lead detail page should degrade while
Lane B's `InsightPanel` or Lane C's `Composer`/`MessageBubble` don't exist yet: decide in
lane. A reasonable approach: import them from their frozen paths as normal; if the files
don't exist yet in your worktree, wrap the import in a small conditional or render a plain
"coming soon" placeholder in their place so the page still builds, and remove the
placeholder once the real component lands after merge.

`modules/crm/service.ts` bodies are yours to write from the start. You are not blocked on
anyone else for the CRM logic itself.

## Handoff notes

Hand off to integration: working `modules/crm/service.ts` + `repository.ts`, all CRM pages
and API routes, `proxy.ts`, and a seed script that produces the volumes above. Lane C's
webhook and Lane D's `crm-flow` test both depend on your `changeStage`, and
`findOrCreateContactByLineUserId` / `findOrOpenLeadForContact` behaving exactly as specified
above.

## Cut list if time runs short

From `docs/design.md`'s risk section, in priority order if the 5-hour budget is tight:

1. Tags: the `Tag` model and `tagIds` UI on contacts (optional per the schema comment:
   "Audience segmentation is out of scope")
2. Company UI polish: keep the API and basic CRUD, trim the page if needed

## Opening prompt

```
Read AGENTS.md and docs/tasks/lane-A.md, then read docs/design.md sections 1 to 8 in full.
Implement the CRM service bodies in modules/crm/service.ts and modules/crm/repository.ts
against the frozen signatures, then the auth and CRM API routes, then the pages, then
prisma/seed.ts. Work only inside the files this lane owns and stop to write a contract
change request instead of editing a frozen file.
```
