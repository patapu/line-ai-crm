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
