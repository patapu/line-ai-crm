# Contract change requests

`docs/design.md` section 1 marks a set of files FROZEN, and three service files as frozen
signature / lane-owned body. No lane may edit a frozen file or a frozen signature directly,
even if the current contract seems wrong or incomplete.

If a lane needs a contract to change, add an entry below using the template, then message
Pakorn (the integration owner) directly to get it decided. Do not proceed on an assumption
that a change will be approved. Keep working on everything else while you wait.

Newest entries go at the top.

## Template

```
### CR-<number>: <short title>

- Date: <YYYY-MM-DD>
- Requested by: <lane, e.g. Lane B>
- File(s): <exact path(s)>
- Current contract: <what it says today>
- Proposed change: <what you want it to say>
- Reason: <why the current contract does not work>
- Impact on other lanes: <who else imports this, what breaks for them>
- Status: OPEN | APPROVED | REJECTED
- Decision: <Pakorn's decision and reasoning, filled in when decided>
```

## Log

### CR-3: Advisory lock in findOrOpenLeadForContact

- Date: 2026-09-15 (renumbered from CR-1 and updated 2026-09-16 after Lane A's merge)
- Requested by: Lane C
- File(s): modules/crm/service.ts (body of findOrOpenLeadForContact only, no signature change)
- Current contract: design section 4 says findOrOpenLeadForContact(tx, { contactId, ownerId, source, actor }) returns the latest lead for the contact that is not WON/LOST, else opens a NEW one. It says nothing about locking, so two concurrent callers for the same contact can both see "no open lead" and both insert a NEW lead. Verified against Lane A's merged code (modules/crm/service.ts, main branch): this is still true, there is no lock of any kind in findOrOpenLeadForContact today. Also verified by reading Lane A's merged code: findOrOpenLeadForContact writes the LEAD_CREATED Activity itself when it opens a lead, with actorId null for the system actor, so Lane C's webhook code is correct to not write a second one; and findOrCreateContactByLineUserId sets firstName to the trimmed displayName if given, else the placeholder 'LINE user', lastName null, source LINE, ownerId null, and lineDisplayName to the trimmed displayName or null. Lane C always passes displayName: null on the webhook path, so a new LINE contact gets firstName 'LINE user', source LINE, ownerId null, lineDisplayName null, and Lane C fills in lineDisplayName later through after() (backfillContactProfile).
- Proposed change: as the first statement inside findOrOpenLeadForContact, take a transaction-scoped lock on the contact id, for example `await tx.$executeRaw\`SELECT pg_advisory_xact_lock(hashtextextended(${'crm:contact:' + input.contactId}::text, 0::bigint))\``, before the find-then-create. Use pg_advisory_xact_lock (transaction scope), not a session lock, because Neon's PgBouncer runs in transaction mode.
- Reason: docs/tasks/lane-C.md task 7 asks Lane C to flag this lock to Lane A, and Lane C must not edit modules/crm/service.ts. The lock this CR asks for protects any caller of findOrOpenLeadForContact that does not already hold Lane C's own lock (key 'line:user:<lineUserId>'). Today the only caller is modules/line/webhook.ts (recordInbound), and it does take that lock before calling either CRM function, so there is no known failing path right now. This CR is defence for future callers that do not go through Lane C's webhook lock, for example a future Lane B feature or an import job. It is not about createLead: createLead (modules/crm/service.ts) never calls findOrOpenLeadForContact, so this CR does not change createLead's behaviour at all. By design, createLead can already open a second lead for a contact that has an open one, with or without any concurrent call; that is a separate, pre-existing behaviour, not a race this CR touches.
- Impact on other lanes: Lane A: body change only. Lane C: none (lock order is always line user lock, then contact lock, so no deadlock). Lane B, Lane D: none.
- Status: OPEN
- Decision:

### CR-2: `client-only` is imported but not declared as a direct dependency

- Date: 2026-09-16
- Requested by: Lane A
- File(s): `package.json` (`dependencies`, owned by Lane F)
- Current contract: `package.json` `dependencies` declares `server-only` but not `client-only`. `components/crm/auth-redirect.ts` starts with `import 'client-only'` (a build time guard so a server component cannot import the 401 redirect helper); today that import resolves only transitively through `next` / `styled-jsx`, not through a declared dependency.
- Proposed change: add `"client-only": "^0.0.1"` to `dependencies`, next to `"server-only"`, pinned to the exact version in `node_modules/client-only/package.json` (`0.0.1`), using the same caret pin style `server-only` already uses.
- Reason: the import breaks if a future `next` or `styled-jsx` release drops or moves that dependency, or if a stricter installer or hoisting layout stops exposing it at the top level. (Alternative considered: replace the import with a runtime `typeof window` guard; Pakorn chose this CR instead.)
- Impact on other lanes: none known. This only adds a dependency declaration; no Lane A code change is needed after it lands.
- Status: APPROVED
- Decision: 2026-09-16, approved by Pakorn ("อนุมัติ CR-1 กับ CR-2 แล้ว merge PR ได้เลย", meaning both CRs are approved and PR #1 can be merged). Implemented as a layer 0 (F) change in PR #2 (https://github.com/patapu/line-ai-crm/pull/2) on branch `layer0-cr-1-cr-2`: `client-only` is declared in `package.json` and `package-lock.json`.

### CR-1: Lead.value max exceeds the Decimal(12,2) column it is stored in

- Date: 2026-09-15
- Requested by: Lane A
- File(s): `lib/contracts/crm.ts` (`LeadCreate.value`, inherited by `LeadUpdate`), `prisma/schema.prisma` (`Lead.value Decimal(12,2)`)
- Current contract: `value: z.number().nonnegative().max(1e10).nullish()` allows a value up to and including `10_000_000_000`, but the column is `Decimal(12,2)`, whose largest representable value is `9_999_999_999.99`.
- Proposed change: change the zod schema's max to `9_999_999_999.99` (or `.lt(1e10)`), so the contract never accepts a value the database cannot store. Also limit the value to 2 decimal places (e.g. `.multipleOf(0.01)`), since a value like `9_999_999_999.999` is under `1e10` but rounds to `10000000000.00` once stored in a `Decimal(12,2)` column and overflows it.
- Reason: a value of exactly `1e10` (or anything up to it) passes validation but is one cent or more above what the column can hold; without a schema fix, only a runtime guard in the service layer prevents an overflow write. Lane A added that guard in `modules/crm/service.ts` (`createLead`, `updateLead`) before the contract was fixed (it now stays as defence in depth, see Decision), but the contract itself should be corrected.
- Impact on other lanes: none known. `LeadCreate`/`LeadUpdate` are only consumed by Lane A's routes and service.
- Status: APPROVED
- Decision: 2026-09-16, approved by Pakorn ("อนุมัติ CR-1 กับ CR-2 แล้ว merge PR ได้เลย", meaning both CRs are approved and PR #1 can be merged). Implemented as a layer 0 (F) change in PR #2 (https://github.com/patapu/line-ai-crm/pull/2) on branch `layer0-cr-1-cr-2`: `lib/contracts/crm.ts` caps `value` at 9,999,999,999.99 in whole cents. Lane A's service guard in `modules/crm/service.ts` stays as defence in depth.
