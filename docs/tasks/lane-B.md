# Lane B: AI Copilot

## Goal

Build the CRM AI copilot: a skill that reads a lead's CRM context and returns a summary,
qualification score with reasons, next-best action, and an optional draft LINE reply, with
a rule-based fallback and guardrails, plus evaluation cases, the routes, and the panel that
let a human review and approve a suggestion.

## Brief section it serves

The AI CRM skill half of the AI copilot and LINE OA integration work: `SKILL.md`, the
skill's behavior, guardrails, failure handling, and evaluation cases.

## Owned files

From `docs/design.md` section 1, exactly:

```
app/api/leads/[id]/insights
app/api/leads/[id]/suggestions
app/api/suggestions/[id]/approve
app/api/suggestions/[id]/reject
components/copilot/InsightPanel.tsx     (props are frozen, see below)
modules/copilot/service.ts              (bodies only; signatures are frozen)
modules/copilot/model.ts
modules/copilot/fallback.ts
modules/copilot/guardrails.ts
modules/copilot/context.ts
modules/copilot/instructions.ts
skills/crm-copilot/SKILL.md
skills/crm-copilot/instructions.md
skills/crm-copilot/evals/cases.json
scripts/eval-copilot.ts
```

`skills/crm-copilot/SKILL.md` already has a skeleton with the right headings. Fill it in,
don't restructure it.

## Frozen files (do not touch)

The full frozen list is in `AGENTS.md`. The ones most relevant to this lane:

- `modules/copilot/types.ts`: fully frozen
- `modules/copilot/service.ts`: the function **signatures** are frozen. You implement the
  bodies; do not change a function's name, parameters, or return type.
- `lib/contracts/copilot.ts`: includes `CopilotOutputSchema` used as the model's structured
  output schema
- `components/copilot/InsightPanel.tsx`: the **props** are frozen,
  `{ leadId: string; canApprove: boolean }`. The internals are yours.
- `modules/line/types.ts` (you only read `LineClient` as a dependency type, you don't
  implement it)
- `lib/db.ts`, `lib/errors.ts`, `lib/http.ts`, `lib/auth/dal.ts`

If any of these need to change, do not edit them. Write up
`docs/contract-change-requests.md` and escalate to Pakorn.

## Contracts to import

From `lib/contracts/copilot.ts`: `InsightRequest`, `SuggestionApprove`, `SuggestionReject`,
`CopilotOutputSchema`.

From `modules/copilot/types.ts`: `LeadContext`, `NextBestActionSchema`, `CopilotOutput`,
`CopilotErrorCode`, `CopilotResult`, the `CrmCopilot` interface, `SuggestDeps`.
`NextBestActionSchema` and `SuggestDeps` are re-exported from `modules/copilot/types.ts`
even though `SuggestDeps` is defined in `modules/copilot/fallback.ts`, so both can be
imported from one place.

From `modules/copilot/service.ts` (frozen signatures you implement): `requestInsight`,
`approveSuggestion`, `rejectSuggestion`.

From `modules/copilot/fallback.ts` (yours to define, referenced by `service.ts` and by
Lane D's tests): `suggestWithFallback`, `ruleBasedSuggestion`, `applyGuardrails`.

From `modules/line/types.ts` (read-only dependency): the `LineClient` interface.
`approveSuggestion` takes `deps: { line: LineClient; db?: Db }` and calls
`line.sendLineMessage`-equivalent behavior through Lane C's module when `send` is `true`.

From `lib/contracts/common.ts`: `ErrorCode`, `ApiErrorBody`. From `lib/db.ts`: `Db`. From
`lib/errors.ts`: `DomainError`. From `lib/http.ts`: `withRoute`. From `lib/auth/dal.ts`:
`Actor`.

## Step-by-step tasks

Drawn from `docs/design.md` section 4 (interfaces, wrapper rules, rule-based fallback,
guardrails, eval cases) and section 5B (draft to send flow), plus plan step 4.

1. Implement the `ai` v7 call exactly as shown in `docs/design.md` section 4: `generateText`
   with `output: Output.object({ schema: CopilotOutputSchema })`, `instructions` (not the
   deprecated `system`), `timeout: { totalMs: deps.timeoutMs }`, `maxRetries: 1`,
   `abortSignal: signal`. Read the result from `result.output`.
2. Implement the wrapper rules in `modules/copilot/fallback.ts` / `suggestWithFallback`, in
   this order:
   1. No `GOOGLE_GENERATIVE_AI_API_KEY` -> fallback, `errorCode: NO_API_KEY`
   2. A second `AbortController` timeout at `COPILOT_TIMEOUT_MS` on top of the SDK's own
      timeout -> fallback, `errorCode: TIMEOUT`
   3. `NoObjectGeneratedError` or a Zod validation failure -> fallback,
      `errorCode: SCHEMA_INVALID`
   4. Any other provider error -> fallback, `errorCode: PROVIDER_ERROR`
   5. A successful result always passes through `applyGuardrails`; if the draft is blocked,
      replace it with the fallback template, set `errorCode: GUARDRAIL_BLOCKED` and
      `lowConfidence: true`, keep `source: MODEL`
   6. `confidence < COPILOT_MIN_CONFIDENCE` or an `INSUFFICIENT_CONTEXT` flag ->
      `lowConfidence: true`
   7. Every fallback result: `source: FALLBACK`, `lowConfidence: true`, `confidence: 0.3`
3. Implement `ruleBasedSuggestion` (pure function): base score by stage (`NEW` 20,
   `QUALIFIED` 45, `PROPOSAL` 65, `WON` 100, `LOST` 0), then adjust: inbound message in the
   last 3 days +15, has a `value` +10, no activity in over 14 days -15, clamp to 0..100. Each
   adjustment that actually fired becomes one entry in `scoreReasons`. Next best action comes
   from a stage lookup table. Draft reply is a Thai/English template with the contact's name;
   `null` if the contact has no `lineUserId`.
4. Implement `applyGuardrails`: draft must not contain a URL, email, or phone number; must
   not contain a percentage/discount/price not already present in context; capped at 500
   characters; score always clamped 0..100.
5. Implement `modules/copilot/service.ts` bodies:
   - `requestInsight`: build `LeadContext` read-only (via `modules/copilot/context.ts`),
     call `suggestWithFallback`, then one transaction that supersedes any existing `PENDING`
     suggestion for the lead, inserts the new `AiSuggestion` as `PENDING`, and writes
     `Activity` type `AI_SUGGESTION_CREATED`. This never touches `Lead` fields and never
     creates a `Message`: that boundary is the whole point of the two-step flow.
   - `approveSuggestion`: if `send` is `true` and the contact has no `lineUserId`, return
     `422` before writing anything. Otherwise, Tx A commits first:
     `updateMany where { id, status: 'PENDING' }` to `APPROVED` (count 0 -> `409`), apply
     score + `SCORE_APPLIED` activity if `applyScore`, write `AI_SUGGESTION_APPROVED` with
     `{ edited }`, and if `send`, call Lane C's `enqueueLineMessage(tx, { leadId, text, actor,
     aiSuggestionId })` inside this same Tx A (it inserts the outbound `LINE` `Message` as
     `QUEUED` with a fresh `retryKey`). Then, outside the transaction, call
     `deliverQueuedMessage(messageId, { line, db })`, following the retry and Tx B rules in
     `docs/design.md` section 5B steps 7 to 8.
   - `rejectSuggestion`: set `REJECTED`, write an activity with the rejection reason.
6. Build `app/api/leads/[id]/insights` (`POST`, `maxDuration = 30`, returns `201`),
   `app/api/leads/[id]/suggestions` (`GET`, suggestion history), and the approve/reject
   routes.
7. Build `components/copilot/InsightPanel.tsx` against the frozen props. Show the "AI
   suggestion not yet saved to the lead" label, a badge for fallback/low-confidence results,
   and let the user edit the draft before approving.
8. Write `skills/crm-copilot/SKILL.md` (fill in the skeleton already there),
   `instructions.md`, and `skills/crm-copilot/evals/cases.json` with the 7 cases listed in
   `docs/design.md` section 4 (also listed in the `SKILL.md` skeleton).
9. Write `scripts/eval-copilot.ts` (`npm run eval:copilot`): runs all 7 cases against the
   real Gemini model, prints a pass/fail table. The `eval:copilot` script runs `tsx` with
   `--conditions=react-server`, because plain `tsx` crashes on any module that imports
   `server-only` (see `docs/design.md` section 10). This script does not run in CI. It runs
   by hand at the integration step (`docs/design.md` plan step 8).

## Acceptance criteria

- [ ] `POST /api/leads/[id]/insights` never returns a 5xx because the model failed; it
      always falls back and returns `201`
- [ ] A model failure, timeout, or low-confidence result produces `source: FALLBACK` /
      `lowConfidence: true` with no `Message` row created
- [ ] `applyGuardrails` blocks a draft containing a URL, email, phone, or an unlisted
      price/discount, and the result still carries `source: MODEL` with
      `errorCode: GUARDRAIL_BLOCKED`
- [ ] Requesting a new insight supersedes the lead's existing `PENDING` suggestion
- [ ] Approving with `send: true` on a contact with no `lineUserId` returns `422` and writes
      nothing
- [ ] Double-clicking approve returns `409` on the second click, not a duplicate approval
- [ ] All 7 eval cases pass against the real Gemini model via `npm run eval:copilot`
- [ ] `skills/crm-copilot/SKILL.md` accurately describes the implemented behavior (Purpose,
      Inputs, Outputs, Allowed actions, Guardrails, Failure behavior, Evaluation cases)
- [ ] `npm run typecheck`, `npm run lint`, `npm test` all pass

## What to stub or mock while other lanes are unfinished

`approveSuggestion` depends on Lane C's `LineClient` / `sendLineMessage` when `send: true`.
Until Lane C's `modules/line/client.mock.ts` lands, write a minimal local `LineClient` test
double inside your own tests that matches the frozen `LineClient` interface
(`modules/line/types.ts`), so `requestInsight` and `approveSuggestion` can be tested without
send. Delete your local stub once Lane C's real mock client is available and switch your
tests to import it instead. Don't keep two mock clients around after merge.

`requestInsight` reads CRM data to build `LeadContext`. The frozen schema and seed data are
enough to build and test this without waiting on Lane A's UI.

## Handoff notes

Hand off to integration: `modules/copilot/*` with all bodies implemented, insights/
suggestions/approve/reject routes, `InsightPanel`, `SKILL.md` + `instructions.md` +
`evals/cases.json` all consistent with each other, and `scripts/eval-copilot.ts` passing
against real Gemini. Lane D's `copilot-fallback` test depends on `suggestWithFallback`
behaving exactly as specified above (throw, hang, and low-confidence cases).

## Cut list if time runs short

From `docs/design.md`'s risk section: the live eval run against real Gemini
(`npm run eval:copilot`) can be skipped under time pressure. The eval cases and the script
itself still need to exist and be committed, just not necessarily run to green before
handoff. Everything else in this lane is required for handoff.

## Opening prompt

```
Read AGENTS.md and docs/tasks/lane-B.md, then read docs/design.md section 4 and the "B. จาก
draft ถึงการส่ง" part of section 5 in full. Implement modules/copilot/fallback.ts first
(rule-based fallback and guardrails, pure functions, easy to test alone), then the ai v7
wrapper, then modules/copilot/service.ts bodies, then the routes and InsightPanel, then
SKILL.md, instructions.md and the 7 eval cases.
```
