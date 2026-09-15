# Lane E: Docs

## Goal

Write the handover documentation: setup/run/deploy instructions, an architecture and
data-flow diagram, API notes, key decisions and trade-offs, and the AI-usage log skeleton
that every lane appends to.

## Brief section it serves

The handover documentation: README setup/run/deploy steps, architecture and data-flow
diagram, API notes, `.env.example` documentation, key trade-offs, known limitations,
production next steps, and the AI-usage log.

## Owned files

From `docs/design.md` section 1, exactly:

```
README.md
docs/architecture.md
docs/api.md
docs/decisions.md
docs/ai-usage-log.md
```

`README.md` and `docs/ai-usage-log.md` already have a skeleton from layer 0. Extend them,
don't discard the structure. `.env.example` is frozen (owned by layer 0, listed in
`docs/design.md` section 8). Lane E documents what's in it, but does not edit the file
itself.

## Frozen files (do not touch)

The full frozen list is in `AGENTS.md`. This lane mainly reads `docs/design.md` and the
`.env.example` contents to write accurate docs about them. It does not need to edit any
frozen file. If something in the frozen contract seems undocumented or missing, that's a
documentation gap to fill, not a reason to edit the frozen file.

## Contracts to import

None. This lane does not write code. It documents the contracts and behavior that
`docs/design.md` and the other four lanes define, so read `docs/design.md` in full plus each
`docs/tasks/lane-X.md` before writing anything.

## Step-by-step tasks

Drawn from `docs/design.md` sections 6 to 9 (auth, logging, Vercel/Neon, what was reused
from an earlier project) and plan step 7.

1. Extend `README.md`: fill in the setup/run/deploy steps once they're confirmed against a
   real deploy, list the seeded demo accounts (`admin@crm.test`, `sales1@crm.test` through
   `sales5@crm.test`, password from `DEMO_PASSWORD`), and add LINE OA test instructions
   (how to friend the test account or scan its QR code, and how `LINE_MODE=mock` vs `live`
   changes what a reviewer sees). Do not mark anything as done or deployed until it actually
   is: this repo is public on GitHub, so anyone reading it sees exactly what is true today.
2. Write `docs/architecture.md`: a mermaid diagram of the request flow (website -> API route
   -> service layer -> Prisma -> Postgres), the LINE webhook path (LINE -> webhook route ->
   `handleLineWebhook` -> CRM module -> DB), and the AI copilot path (route -> `requestInsight`
   -> Gemini or fallback -> `AiSuggestion`, then a separate approve step -> LINE send). Base
   it on `docs/design.md` sections 1 and 5, not on assumptions. If a detail isn't in the
   design doc or the merged code, write "decide in lane" or ask Pakorn rather than inventing
   it.
3. Write `docs/api.md`: document the API table from `docs/design.md` section 3 (method,
   path, auth requirement, purpose) in prose, plus example request/response bodies once the
   routes exist. Keep it in sync with the actual implemented routes, not just the design
   table. Check for drift before finishing.
4. Write `docs/decisions.md`: expand `docs/design.md`'s "Tradeoffs" section into full
   decision records covering route handlers over server actions, synchronous webhook processing
   instead of a queue, in-request plus manual retry instead of a background worker,
   stateless JWT sessions, `adapter-pg` over `adapter-neon`, testing against real Postgres
   instead of mocking Prisma, and migrating during the Vercel build instead of in GitHub
   Actions. Also record the modular monolith reasoning from section 1 (why not
   microservices yet).
5. Keep `docs/ai-usage-log.md`'s template in place; it is not this lane's job to write other
   lanes' entries, only to make sure the template is usable and to add this lane's own entry
   for its own session.
6. Add monitoring notes to `docs/architecture.md` or `docs/api.md` from `docs/design.md`
   section 7: uptime check on `/api/health`, filtering Vercel Logs by event name, and the
   three alert signals (`line.push.failed`, `copilot.fallback_used`, count of `FAILED`
   `WebhookEvent` rows).
7. Record known limitations plainly: the UNVERIFIED items from `docs/design.md` sections 8
   and the risk section (PgBouncer + prepared statements, `attachDatabasePool` on Fluid
   compute, Vercel plan time limits), and the in-memory best-effort login rate limit.

## Acceptance criteria

- [ ] `README.md` has real setup/run/deploy steps, seeded demo accounts, and LINE OA test
      instructions, with no placeholder TODOs left once the corresponding lane work is merged
- [ ] `docs/architecture.md` has a mermaid diagram covering the CRM request path, the LINE
      webhook path, and the AI copilot path
- [ ] `docs/api.md` matches the actually implemented routes, not just the design table
- [ ] `docs/decisions.md` covers every trade-off listed in `docs/design.md`'s "Tradeoffs"
      section, each with reason and cost
- [ ] Known limitations and UNVERIFIED items from `docs/design.md` are stated plainly, not
      glossed over
- [ ] `docs/ai-usage-log.md` keeps its template and has at least this lane's own entry
- [ ] Nothing in these docs claims a feature is done that isn't actually merged and working
- [ ] No dash punctuation anywhere in these docs, per `AGENTS.md`'s communication rule
- [ ] `npm run lint` still passes (docs changes shouldn't touch lint, but confirm)

## What to stub or mock while other lanes are unfinished

Nothing to stub. This lane can start immediately from `docs/design.md`, in parallel with A,
B, C, and D. The parts that describe deployed URLs,
demo credentials, and LINE test instructions can only be finished once Lane D's deploy
scripts and Lane C's LINE setup exist. Leave those as explicit TODO sections (see the
skeleton already in `README.md`) rather than guessing at values that don't exist yet.

## Handoff notes

Hand off to integration: an accurate README a stranger could use to run and deploy the
project, an architecture diagram that matches what actually got built, API notes that match
the actual routes, and a decisions doc that explains the trade-offs clearly. These docs are
public evidence of documentation ability, since the repo is public. Keep them clean and
accurate over exhaustive.

## Cut list if time runs short

`docs/design.md`'s risk section priority list (tags, company UI, simulate UI, live eval)
belongs to other lanes. If this lane's 1.5-hour budget is tight, prioritize in this order:
README (submission requires it) > architecture diagram (submission requires it) >
decisions.md > api.md (useful but the design doc's API table already covers the essentials).

## Opening prompt

```
Read AGENTS.md and docs/tasks/lane-E.md, then read docs/design.md in full, especially
sections 6 to 9 and the Tradeoffs and risk sections at the end. Extend README.md and
docs/ai-usage-log.md from their existing skeletons, then write docs/architecture.md with a
mermaid diagram, docs/api.md, and docs/decisions.md. Mark anything not yet merged from
another lane as TODO rather than describing it as done.
```
