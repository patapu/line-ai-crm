# AI usage log

This log exists to show real, reviewed use of AI coding agents, not a retrospective summary.
Every agent session appends one entry before finishing, using the template below. Entries
are written from the actual session as it happens. They are never reconstructed afterward.

Newest entries go at the top.

## Template

```
### <YYYY-MM-DD>, Lane <A|B|C|D|E>

**Sample tasks / prompts**
- <a representative prompt or task given to the agent this session>
- <another one, if useful>

**What the human reviewed or rejected**
- <something the agent produced that Pakorn checked, and what he found>
- <anything rejected or sent back, and why>

**One change made after human inspection**
- <a concrete example: before -> after, and the reason for the change>
```

## Log

### 2026-09-17, Lane C

**Sample tasks / prompts**
- After PR #2 merged, Pakorn approved rebasing lane-c-line onto main again and force pushing ("ทำเลย rebase แล้ว
  force push ได้"); after PR #5 (Lane A's cent values change) merged, he approved the same again. orchestrator
  planned each round; in both rounds the main agent rebased (no conflicts) and force pushed with a lease;
  code-tester ran typecheck, lint and the tests (249/249) each time, plus npm ci in the first round and the
  webhook database tests 3 times (15/15 each) in the second.
- Pakorn said "merge PR #4 ได้เลย" and separately asked for the status of PR #3 (Lane B, still open, with
  conflicts in docs/ai-usage-log.md) and PR #7 (merged).
- Pakorn asked for the manual mock-mode check from PR #4's test plan; orchestrator planned and code-explorer
  researched how to force a failed message without any code change.
- Once the check found a gap, Pakorn asked to open a new CR; code-doc-writer drafted CR-4. Pakorn then approved
  CR-4 ("approve") and asked to push the branch, open a PR, and add this log entry.

**What the human reviewed or rejected**
- Pakorn has not reviewed a code diff himself in this period.
- Pakorn approved both rebase and force push rounds above. PR #5 had changed Lane A's modules/crm/service.ts,
  and code-tester reran the gates after that rebase; one force push attempt was first rejected locally by git
  because the main agent had typed an invalid lease SHA, so nothing was sent, and it then read the full SHA
  from git ls-remote.
- Pakorn said "merge PR #4 ได้เลย", but the main agent's merge attempt was blocked by the Claude Code auto
  mode permission classifier ("Merge Without Review") before anything ran. He asked to add a permission
  rule; the main agent declined to edit permission settings itself and gave him the settings.json
  instructions and the risks of allowing everything. Pakorn merged PR #4 himself, and at his request
  the main agent deleted the lane-c-line branch on origin and locally, after checking it was merged.
- Pakorn approved the manual check's method: writing synthetic rows to the shared dev database, forcing one sent
  message to FAILED with SQL, and running the server in the Browser pane. At that time he chose no
  usage log entry for the check itself; it is recorded here because he later asked for an entry
  covering the CR-4 work that came out of it. The first login failed with a 403 origin mismatch
  because the APP_URL override set through cmd did not reach next dev, and the main agent restarted
  the server with the environment set through PowerShell; the second failed because this worktree's
  DEMO_PASSWORD was the .env.example placeholder while the dev database had been seeded from Lane
  A's worktree .env, which the main agent found by comparing the values by hash only. Pakorn then
  logged in himself; the assistant never read or typed the password.
- Pakorn approved CR-4 ("approve").

**One change made after human inspection**
- After Pakorn logged in, the main agent drove the browser and ran read-only database checks: simulated
  inbound message PASS, reply sent from the lead page PASS, retry API called from the page PASS
  (including the duplicate 409 path), Retry button FAIL. MessageBubble is never mounted: Lane A's
  Timeline renders messages itself and forbids importing MessageBubble, so a failed LINE message
  has no Retry button even though the retry API itself works. That gap became CR-4, which Pakorn
  then approved. Afterwards the server was stopped, AGENTS.md reverted, and the temporary launch
  config removed.
- Found by the main agent, not a human: the first CR-4 draft overstated that the design docs place the Retry
  button inside MessageBubble; the docs only define the retry route, and the button placement was Lane C's own
  design. The sentence was corrected before committing.

### 2026-09-16, Lane C

**Sample tasks / prompts**
- Pakorn asked to check whether Lane A had merged into main, then to rebase lane-c-line onto main and force push
  once it had, then to open a PR into main, and finally to add this log entry.
- orchestrator planned each step. The main agent checked the Lane A merge with git and gh, did the rebase and
  resolved its conflicts, committed, force pushed, and opened PR #4. code-explorer read Lane A's CRM code;
  code-implementer rewrote webhook.db.test.ts and the CR-3 text; code-tester ran the baseline and final
  gates and the mutation runs; code-reviewer reviewed the change twice; code-doc-writer wrote this entry.
- orchestrator's first plan for this log entry had two errors (a step that would create a .context folder inside
  the repo, and a task id without the lane suffix); the main agent sent it back and the revised plan fixed both.

**What the human reviewed or rejected**
- Pakorn asked twice whether Lane A had merged. The first check found it had not (Lane A's PR #1 was still open);
  the second check found it had (origin/main was at 58ff6dc).
- Pakorn approved rebasing lane-c-line onto main and force pushing ("ทำเลย rebase แล้ว force push ได้"). The rebase
  had conflicts only in docs/contract-change-requests.md and docs/ai-usage-log.md, which the main agent
  resolved before it force pushed the branch with a lease, from 0dea411 to 0d6452e.
- Pakorn has not reviewed the Lane C code diff himself in this session. The review came from the code-reviewer
  agent in two passes: the first found 1 major (a wrong createLead claim in the CR-3 text, see below)
  and 3 minors, and the second found 0 blocking issues.
- Pakorn said "เปิด PR เข้า main ได้เลย" and the main agent opened PR #4 (lane-c-line into main) with gh. It has
  not been merged yet.
- Pakorn asked for this log entry to be added.

**One change made after human inspection**
- Because of Pakorn's rebase and force push approval: Lane C's contract change request was renumbered from CR-1 to
  CR-3, since main already had Lane A's CR-1 and CR-2. The webhook database tests were switched from tx-backed fake
  CRM functions to Lane A's real findOrCreateContactByLineUserId and findOrOpenLeadForContact, through a partial
  vi.mock that delegates to the real functions; that switch, together with reading Lane A's merged code, confirmed
  findOrOpenLeadForContact writes the LEAD_CREATED activity itself, which CR-3 now records under
  "Current contract".
- Found by the code-reviewer agent, not by a human: the CR-3 text wrongly claimed CR-3 would close a race between a
  manual createLead and a webhook delivery, but createLead never calls findOrOpenLeadForContact. The text was
  corrected to say CR-3 is defence for future callers and does not change createLead.
- The case 7 rollback test was made meaningful: the real findOrOpenLeadForContact now runs inside the transaction
  before the forced failure, so the test proves the lead and its LEAD_CREATED activity roll back together.
- Mutation runs, actually executed by code-tester, checked that the tests catch regressions: removing
  lockLineUser made the concurrent delivery test (case 9) fail, and removing the forced failure made
  case 7 fail; both guards were then restored.

### 2026-09-15, Lane C

**Sample tasks / prompts**
- Opening prompt from docs/tasks/lane-C.md: build signature.ts and client.mock.ts first (Lanes B and D depend on
  them), then the webhook route, then send and retry, following design sections 5A, 5B steps 6 to 10, and 10.
- Work was split across agents: orchestrator planned; provisioner set up the worktree and the test database;
  code-explorer, code-planner, code-implementer, code-tester and code-reviewer did the lane work in three phases
  (clients, webhook, send/retry plus UI).

**What the human reviewed or rejected**
- Pakorn decided where the database tests run. vitest.setup.ts points at `crm_test`, which did not exist in the
  shared container. The options were: create `crm_test`, reuse the dev database `crm`, or skip DB tests when no
  database is reachable. He chose to create `crm_test` (a new database plus `prisma migrate deploy` only, no reset,
  no drop).
- Pakorn has not reviewed the Lane C code itself yet. The code review in this session came from the code-reviewer
  agent (first pass: 0 critical, 1 major, 8 minor, 9 nit), and the fixes were checked by tests, not by a human.
- After the agent re-review came back with 0 blocking findings and 3 minor ones, Pakorn read that summary and
  decided the 3 minors had to be fixed before the branch was pushed ("แก้ minor 3 ข้อก่อน แล้วค่อย push").

**One change made after human inspection**
- Before: the Lane C database tests would have targeted `crm_test`, which did not exist, so they could only fail or
  be pointed at the shared dev database. After: `crm_test` exists with both migrations, and every Lane C database
  test runs there, creating and deleting only its own synthetic rows by id. Reason: Pakorn picked this option over
  reusing the dev database `crm`.
- Also from Pakorn's push condition: before, `MessageBubble` called `Date.now()` during render to hide Retry after
  23 hours (a hydration mismatch risk), and two tests (the 23 hour retry refusal and the streamed 1 MB webhook cap)
  would still pass with the guard they claimed to cover removed. After: the expiry check runs only after mount
  through `useSyncExternalStore`, and both tests were rewritten so they would fail if their guard were removed
  (confirmed by the code-reviewer agent reasoning through the assertions, not by running the mutated code).

### 2026-09-15, Lane A

**Sample tasks / prompts**
- Opening prompt from docs/tasks/lane-A.md: "Implement the CRM service bodies in modules/crm/service.ts
  and modules/crm/repository.ts against the frozen signatures, then the auth and CRM API routes,
  then the pages, then prisma/seed.ts. Work only inside the files this lane owns and stop to write
  a contract change request instead of editing a frozen file."
- The session ran as a planned pipeline: research brief, file-by-file plan, then implement, test,
  and review for each phase. The plan was revised once so the seed ran before the API smoke test,
  which needed seeded accounts to log in.
- Verification the agents ran: typecheck, lint, 73 unit tests (mocked db), a live API smoke test
  (17 checks) and a page render smoke test (17 checks) on a spare port, and the seed run twice to
  prove it is idempotent (same row counts and the same md5 of lead rows).

**What the human reviewed or rejected**
- Pakorn approved keeping three colocated test files that the AGENTS.md ownership table does not
  list: modules/crm/service.test.ts, components/crm/safe-next.test.ts, and
  app/api/auth/login/route.test.ts.
- Pakorn approved deleting the layer 0 placeholder app/page.tsx, which clashed with
  app/(app)/page.tsx on the `/` route.
- Pakorn accepted four assumptions the design did not settle: SALES users can only create leads
  they own, any signed-in user may edit or delete contacts and companies, `tagIds` is supported in
  the service with no UI yet, and seeded contacts use a WEBSITE 45 / MANUAL 40 / LINE 15 source mix.
- Nothing was rejected.

- Pakorn read the four non-blocking minors left after the last review round and decided they must
  be fixed before the branch is pushed and a PR is opened.

**One change made after human inspection**
- Because of Pakorn's decision above, the four minors were fixed before push. Example: before, the
  lead, contact, company, activity, stage and delete forms only showed an error text when the
  session had expired (HTTP 401). After, they share one helper (`components/crm/auth-redirect.ts`)
  that sends the user to `/login?next=<current page>`, and the login page sanitizes that `next`
  value. The other three: the timeline tie re-fetch now has a fixed order and a comment stating its
  500 row limit, the email-only login limiter now has tests, and the `value` error text now says
  "must be at most 9,999,999,999.99".
- Earlier in the session, the biggest change after review came from the code-reviewer agent, not a
  human: `safeNext` (the post-login `next` redirect check) first only rejected values starting with
  `//` or `/\`, so `/login?next=/%09/evil.com` and `/login?next=/.//evil.com` could still send a user
  off-site. It now rejects control characters and backslashes, resolves the value against a dummy
  origin, requires the same origin, and rejects a resolved path that starts with `//`.
- Pakorn then asked for the five remaining review nits to be fixed as well. They were: a wrong
  comment about what vitest restores between tests, a missing test for the message side of the
  timeline tie re-fetch, a comment typo, an unneeded `use client` directive, and a hand written
  window stub in a test. All five are fixed, and the gates were run again: 85 tests passing, lint
  with no errors, typecheck and build passing.
- After that review, Pakorn asked for its three informational notes to be closed too: the
  timeline tie cap is now an exported constant that the tests import instead of a hard coded 500,
  every IP in the login tests now sits in a reserved documentation range, and the 401 redirect
  helper now starts with `import 'client-only'`, so a server component that imports it fails the
  build instead of failing at runtime. Gates passed again with 85 tests.
- Pakorn chose to file CR-2 asking layer 0 to declare client-only in package.json, rather than
  replacing the import with a runtime guard, and asked for two test naming nits to be fixed (test
  titles now name TIE_REFETCH_CAP, a comment no longer cites line numbers).
- On 2026-09-16 Pakorn approved CR-1 and CR-2 and asked for PR #1 to be merged; the approvals are
  recorded in docs/contract-change-requests.md, and the frozen file changes they call for are left
  for a separate layer 0 change.
- Pakorn then asked for CR-1 and CR-2 to be implemented as a separate PR; on branch
  layer0-cr-1-cr-2, the lead value contract now caps at 9,999,999,999.99 with cents only
  (multipleOf 0.01) and client-only is declared in package.json, with Lane A's service guard kept
  as defence in depth.
- Pakorn also asked for docs/design.md to match, so its copy of the lead value contract now shows
  the new cap and cents rule, and its package list now names client-only next to server-only.
- Pakorn then asked for PR #2 to get extra boundary tests (whole cent values near the cap must
  pass, non cent values below the cap must fail with the multiple of error) and consistent CR-1
  and CR-2 decision wording, and for PR #2 to be merged after that.
- Pakorn then asked for a separate Lane A PR so the lead form accepts cent values (the value
  input used step 1, which made the browser block 19.99 even though the contract allows cents)
  and so the service guard comment describes it as defence in depth instead of a stopgap. Review
  then caught that the first version of the new comment wrongly named prisma/seed.ts as a
  guarded caller, so the comment now says it protects any direct caller that skips contract
  parsing. Pakorn asked for this PR to be opened and merged.
- Pakorn asked to drop "stopgap" from the CR-1 Reason line; it now points to defence in depth.
- Pakorn asked for the last three review nits: the service guard comment now says it protects
  against overflow, the design.md package line separates runtime and dev packages, and the below
  cap reject tests also assert no too_big issue.
