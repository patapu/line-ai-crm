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

### 2026-09-16, Lane B

**Sample tasks / prompts**
- Opening prompt from docs/tasks/lane-B.md: implement modules/copilot/fallback.ts first, then the ai v7 wrapper, the service.ts bodies (approval runs enqueueLineMessage inside Tx A and deliverQueuedMessage after commit), the four copilot routes and InsightPanel, then SKILL.md, instructions.md and the 7 eval cases.
- Work ran through a planner, implementer, tester and reviewer loop: 6 review passes on the guardrail that blocks unlisted prices, percents and discounts in AI drafts. From the third round on, each fix round wrote failing tests first.

**What the human reviewed or rejected**
- Pakorn was shown that three regex rounds on the "is this number a price?" guardrail kept trading false positives for missed prices (for example "ราคาพิเศษ 9,900 สัปดาห์นี้" slipped through). He rejected another regex patch, a word segmenter approach and "ship as is", and chose flag-by-default: any number in a draft that is not in trusted data is flagged unless it is a count or duration with a unit, an ascending range, or a clear date or time (dates and times exempt by his choice).
- When the review budget ran out with 3 bypasses left ("September 20% off", "30 ก.ย. 2029 บาท", math bold digits), he approved exactly one more fix round instead of documenting them.
- The final review found that round introduced a regression (a guard added in collectAllowedFigures let a trusted phone number "08 1234 5678" whitelist a draft "5678 บาท"). He rejected keeping it.

**One change made after human inspection**
- modules/copilot/guardrails.ts collectAllowedFigures: `if (digitCount >= 9 && digitCount <= 15 && !/\d{4,}\s\d{4,}/.test(m[0]))` -> `if (digitCount >= 9 && digitCount <= 15)`. Reason: Pakorn chose to fail closed. A space-separated price list in trusted text may now be read as a phone run and flagged, but a phone number can no longer license a price. The remaining known bypasses (double space or tab before a currency marker inside a date, markers such as ".-" and "บ.", superscript digits) are listed under Known limits in skills/crm-copilot/SKILL.md.
