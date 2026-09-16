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

### CR-2: `client-only` is imported but not declared as a direct dependency

- Date: 2026-09-16
- Requested by: Lane A
- File(s): `package.json` (`dependencies`, owned by Lane F)
- Current contract: `package.json` `dependencies` declares `server-only` but not `client-only`. `components/crm/auth-redirect.ts` starts with `import 'client-only'` (a build time guard so a server component cannot import the 401 redirect helper); today that import resolves only transitively through `next` / `styled-jsx`, not through a declared dependency.
- Proposed change: add `"client-only": "^0.0.1"` to `dependencies`, next to `"server-only"`, pinned to the exact version in `node_modules/client-only/package.json` (`0.0.1`), using the same caret pin style `server-only` already uses.
- Reason: the import breaks if a future `next` or `styled-jsx` release drops or moves that dependency, or if a stricter installer or hoisting layout stops exposing it at the top level. (Alternative considered: replace the import with a runtime `typeof window` guard; Pakorn chose this CR instead.)
- Impact on other lanes: none known. This only adds a dependency declaration; no Lane A code change is needed after it lands.
- Status: OPEN
- Decision: <Pakorn's decision and reasoning, filled in when decided>

### CR-1: Lead.value max exceeds the Decimal(12,2) column it is stored in

- Date: 2026-09-15
- Requested by: Lane A
- File(s): `lib/contracts/crm.ts` (`LeadCreate.value`, inherited by `LeadUpdate`), `prisma/schema.prisma` (`Lead.value Decimal(12,2)`)
- Current contract: `value: z.number().nonnegative().max(1e10).nullish()` allows a value up to and including `10_000_000_000`, but the column is `Decimal(12,2)`, whose largest representable value is `9_999_999_999.99`.
- Proposed change: change the zod schema's max to `9_999_999_999.99` (or `.lt(1e10)`), so the contract never accepts a value the database cannot store. Also limit the value to 2 decimal places (e.g. `.multipleOf(0.01)`), since a value like `9_999_999_999.999` is under `1e10` but rounds to `10000000000.00` once stored in a `Decimal(12,2)` column and overflows it.
- Reason: a value of exactly `1e10` (or anything up to it) passes validation but is one cent or more above what the column can hold; without a schema fix, only a runtime guard in the service layer prevents an overflow write. Lane A added that guard in `modules/crm/service.ts` (`createLead`, `updateLead`) as a stopgap, but the contract itself should be corrected.
- Impact on other lanes: none known. `LeadCreate`/`LeadUpdate` are only consumed by Lane A's routes and service.
- Status: OPEN
- Decision: <Pakorn's decision and reasoning, filled in when decided>
