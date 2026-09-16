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
