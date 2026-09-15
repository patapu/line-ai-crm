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

(No requests yet.)
