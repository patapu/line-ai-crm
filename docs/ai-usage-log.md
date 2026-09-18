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

### 2026-09-18, Lane D

**Sample tasks / prompts**
- After CR-5 (lane D owns `Dockerfile`, `.dockerignore`, `build.ps1`, `deploy/**`), Pakorn said "yes" to starting lane D work: write the VPS deploy files, then run typecheck, lint, test and a local docker build. No push, no VPS action.
- orchestrator planned it; code-explorer gathered facts (standalone output, `prisma.config.ts` reads `DIRECT_URL` at load, `skills/` read at runtime); code-implementer wrote the files; code-tester ran typecheck, lint, tests (1208 passed) and a standalone build; provisioner built the runner and migrate images locally and smoke tested them against the local dev db (`/api/health` 200).

**What the human reviewed or rejected**
- The deploy files follow the VPS layout that read only checks found on 2026-09-17 (Caddy on the shared `web` network, one compose project per app under `/root/<name>-stack`).
- code-reviewer found 2 majors in the first draft: the `SESSION_SECRET` placeholder in `deploy/ai-crm.env.example` was 46 characters, so it passed the `min(32)` check and a forgotten edit would run production with a secret from git; and the Postgres service had the generic name `db` while the app also joins the shared `web` network. Both were fixed and a second review found no blocking issues.
- The first draft also set `COPILOT_TIMEOUT_MS=25000` instead of the 15000 given in the brief; it was changed back to 15000. Pakorn still decides the final value.

**One change made after human inspection**
- `deploy/ai-crm.env.example`: `SESSION_SECRET=CHANGE_ME_generate_with_openssl_rand_base64_48` -> `SESSION_SECRET=CHANGE_ME`. Reason: a placeholder shorter than 32 characters fails validation, so the app refuses to work instead of running with a known secret (verified: the runner returns 503 with the placeholder).

### 2026-09-17, Lane B

**Sample tasks / prompts**
- "แก้จุด minor ใน InsightPanel ด้วย", then "แก้ 2 จุดนั้นก่อนแล้วค่อย push": fix InsightPanel race conditions between the first history load and Ask AI, approve and reject (a load error shown over a running action, a stale pending suggestion shown after a failed Ask AI).
- "merge main แล้ว push เลย": merge main (Lane C, CR-1, CR-2) into lane-b-copilot again and check Lane B's approve flow against Lane C's real enqueueLineMessage and deliverQueuedMessage.

**What the human reviewed or rejected**
- Pakorn chose to fix the two highest-value InsightPanel minors before pushing instead of pushing the earlier commit as is.
- The cross-lane review found that the lead page renders no retry control for FAILED or QUEUED LINE messages (Lane A's Timeline never mounts Lane C's MessageBubble). Pakorn chose to push Lane B anyway and file a CR for Lane A, which duplicated Lane C's CR-4 on the same issue, rather than hold the branch.
- After reviewing CR-4, Pakorn chose option (a): Lane A renders Timeline messages through MessageBubble so a failed LINE send can be retried; when merging main he kept Lane C's CR-4 as the single entry and Lane B's follow-up was added to it.
- Pakorn asked for the remaining InsightPanel minors to be fixed. A review had shown that an approved or rejected card could disappear when a later Ask AI failed; the Ask AI failure decision was moved into a tested pure helper, and a mutation check confirmed the tests fail if the code compares against the stashed suggestion instead of the rendered one.
- Pakorn then asked for four small review leftovers (an unused variable behind a new lint warning, a router-triggered reset, two weak tests, stale decision inputs) to be fixed before pushing, rather than pushing with them open.
- Pakorn added the Gemini key and asked for the live eval. With the default COPILOT_TIMEOUT_MS of 8000 ms, 4 of 7 cases passed and 3 fell back with TIMEOUT at about 8 s. Re-run for this check only with COPILOT_TIMEOUT_MS=25000: 7 of 7 passed from the model, with latencies between about 3.4 s and 7.4 s.
- After Lane A landed CR-4, Pakorn asked for the InsightPanel status text to be checked against the real Retry button; the QUEUED text was changed to name Retry and mention the 1 minute wait.

**One change made after human inspection**
- components/copilot/InsightPanel.tsx, Ask AI failure path: re-picking the pending suggestion compared the refreshed list against the stashed suggestion -> it now compares against the suggestion actually rendered at click time. Reason: the review showed the old comparison left a confirmed pending suggestion hidden with no Approve or Reject button.

### 2026-09-17, Lane A

**Sample tasks / prompts**
- "ทำ CR-4 เป็น PR แยกแล้ว merge เลย" (implement CR-4 as a separate PR, then merge it).

**What the human reviewed or rejected**
- CR-4 did not say whether message items should keep the Timeline card and header around
  MessageBubble, which has its own header. Pakorn was asked and chose MessageBubble alone for
  message items, with activity items unchanged.

**One change made after human inspection**
- Before: Timeline rendered every item, including messages, inside its own card with a
  timestamp and channel badge, and never mounted MessageBubble, so failed LINE messages had no
  Retry button. After: message items render as MessageBubble alone with `canRetry` from the
  lead page, so the Retry button appears for the lead owner or an admin, and nothing is shown
  twice.

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

### 2026-09-16, Lane B

**Sample tasks / prompts**
- Opening prompt from docs/tasks/lane-B.md: implement modules/copilot/fallback.ts first, then the ai v7 wrapper, the service.ts bodies (approval runs enqueueLineMessage inside Tx A and deliverQueuedMessage after commit), the four copilot routes and InsightPanel, then SKILL.md, instructions.md and the 7 eval cases.
- Work ran through a planner, implementer, tester and reviewer loop: 6 review passes on the guardrail that blocks unlisted prices, percents and discounts in AI drafts. From the third round on, each fix round wrote failing tests first.
- After Lane A merged into main: merge origin/main into lane-b-copilot, then fix the Lane B findings from a review of how Lane A code touches Lane B (401 redirect in InsightPanel, stage change details in the model context, InsightPanel restyled to Lane A Card and Thai labels, wrong lane markers in file headers).

**What the human reviewed or rejected**
- Pakorn was shown that three regex rounds on the "is this number a price?" guardrail kept trading false positives for missed prices (for example "ราคาพิเศษ 9,900 สัปดาห์นี้" slipped through). He rejected another regex patch, a word segmenter approach and "ship as is", and chose flag-by-default: any number in a draft that is not in trusted data is flagged unless it is a count or duration with a unit, an ascending range, or a clear date or time (dates and times exempt by his choice).
- When the review budget ran out with 3 bypasses left ("September 20% off", "30 ก.ย. 2029 บาท", math bold digits), he approved exactly one more fix round instead of documenting them.
- The final review found that round introduced a regression (a guard added in collectAllowedFigures let a trusted phone number "08 1234 5678" whitelist a draft "5678 บาท"). He rejected keeping it.
- Pakorn approved keeping components/copilot/insight-panel-helpers.ts and the colocated Lane B test files (modules/copilot/*.test.ts, components/copilot/*.test.ts), which the AGENTS.md ownership table does not list.
- He has not yet decided whether a SALES user who does not own a lead may press Ask AI and supersede the owner's pending suggestion, so that behaviour was left unchanged.

**One change made after human inspection**
- modules/copilot/guardrails.ts collectAllowedFigures: `if (digitCount >= 9 && digitCount <= 15 && !/\d{4,}\s\d{4,}/.test(m[0]))` -> `if (digitCount >= 9 && digitCount <= 15)`. Reason: Pakorn chose to fail closed. A space-separated price list in trusted text may now be read as a phone run and flagged, but a phone number can no longer license a price. The remaining known bypasses (double space or tab before a currency marker inside a date, markers such as ".-" and "บ.", superscript digits) are listed under Known limits in skills/crm-copilot/SKILL.md.

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
