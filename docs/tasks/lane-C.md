# Lane C: LINE

## Goal

Build the LINE Official Account integration: signature verification, the live and mock LINE
clients, the inbound webhook, outbound send and retry, the dev simulate route, and the
message components on the lead detail page.

## Brief section it serves

The LINE OA integration half of the AI copilot and LINE OA integration work: webhook
signature verification, inbound capture, LINE-user-to-contact/lead mapping, persisted
events, replies, and retry/idempotency with a mock adapter for local tests.

## Owned files

From `docs/design.md` section 1, exactly:

```
app/api/leads/[id]/messages
app/api/messages/[id]/retry
app/api/line/webhook/route.ts
app/api/dev/line/simulate/route.ts
components/messages/Composer.tsx   (props frozen)
components/messages/MessageBubble.tsx   (props NOT frozen, lane owned)
modules/line/service.ts     (bodies only; signatures are frozen)
modules/line/signature.ts
modules/line/client.ts      (factory)
modules/line/client.live.ts
modules/line/client.mock.ts
modules/line/webhook.ts
```

## Frozen files (do not touch)

The full frozen list is in `AGENTS.md`. The ones most relevant to this lane:

- `modules/line/types.ts`: fully frozen (`LineTextMessage`, `LineOutboundMessage`,
  `PushResult`, `LineProfile`, the `LineClient` interface)
- `modules/line/service.ts`: the function **signatures** are frozen. You implement the
  bodies; do not change a function's name, parameters, or return type.
- `lib/contracts/line.ts`
- `components/messages/Composer.tsx`: the **props** are frozen,
  `{ leadId: string; canSend: boolean; hasLine: boolean }`. Internals are yours.
  `components/messages/MessageBubble.tsx` is fully lane owned, props included.
- `modules/crm/service.ts`, `modules/crm/types.ts` (you call into CRM, you don't own it;
  `line` is allowed to import `crm`, never the other way around)
- `lib/db.ts`, `lib/errors.ts`, `lib/http.ts`, `lib/auth/dal.ts`

If any of these need to change, do not edit them. Write up
`docs/contract-change-requests.md` and escalate to Pakorn.

## Contracts to import

From `lib/contracts/line.ts`: `MessageSend`, `LineEvent`, `LineWebhookBody`.

From `modules/line/types.ts`: `LineTextMessage`, `LineOutboundMessage`, `PushResult`,
`LineProfile`, the `LineClient` interface.

From `modules/line/service.ts` (frozen signatures you implement): `WebhookOutcome`,
`RETRY_KEY_MAX_AGE_MS`, `handleLineWebhook`, `recordInboundMessage`, `enqueueLineMessage`,
`deliverQueuedMessage`, `sendLineMessage`, `retryMessage`.

From `modules/crm/service.ts` (read-only dependency, Lane A implements the bodies):
`findOrCreateContactByLineUserId`, `findOrOpenLeadForContact`.

From `lib/contracts/common.ts`: `ErrorCode`, `ApiErrorBody`. From `lib/db.ts`: `Db`, `Tx`.
From `lib/errors.ts`: `DomainError`. From `lib/http.ts`: `withRoute`. From `lib/auth/dal.ts`:
`Actor`.

## Step-by-step tasks

Drawn from `docs/design.md` section 5A (inbound webhook), 5B steps 6-10 (send/retry), and
section 10 (verified LINE facts, which override anything earlier that conflicts). Plan
step 5.

1. Implement `modules/line/signature.ts`: HMAC SHA256 of the raw request body with the LINE
   channel secret, base64-encoded, compared to `x-line-signature` with `timingSafeEqual`
   after a length check first. Never throws.
2. Implement `modules/line/client.live.ts` and `modules/line/client.mock.ts` against the
   frozen `LineClient` interface. The mock client (`MockLineClient`) must use the exact same
   HMAC code as the live client for `verifySignature`. It is a security test target, not
   just a stub. It also needs `sign()`, `failNext()`, an in-memory `sent` array, and
   `getProfile()` returning `{ userId, displayName: 'Mock ' + userId.slice(-4) }`. See
   `docs/design.md` section 4 for the exact shape.
3. Implement `modules/line/client.ts`'s `getLineClient()` factory: reads `LINE_MODE`
   (`mock`/`live`), memoized per process.
4. Implement `app/api/line/webhook/route.ts` (`runtime = 'nodejs'`, `maxDuration = 10`)
   following `docs/design.md` section 5A exactly:
   1. `raw = Buffer.from(await request.arrayBuffer())`, once. Over 1 MB -> `413`.
   2. Verify signature on the raw bytes, before any JSON parsing. Invalid -> `401`, write
      nothing to the DB, log `line.webhook.signature_invalid` without the body.
   3. Only then `JSON.parse` and `LineWebhookBody.safeParse`. Invalid -> `400`. Empty
      `events` (LINE console's Verify button) -> `200`.
   4. Per event, in order: insert `WebhookEvent` as `RECEIVED`; on a unique
      `webhookEventId` collision (`P2002`), read the existing row: `PROCESSED`/`IGNORED`
      counts as a duplicate and is skipped, `FAILED` is reprocessed. For a text `message`
      event with `source.userId`, do `findOrCreateContactByLineUserId` ->
      `findOrOpenLeadForContact` (owner = `LINE_INBOUND_OWNER_EMAIL`, else the first admin;
      actor is `system`) -> `recordInboundMessage` (`lineMessageId` unique is the second
      dedupe guard) -> mark `PROCESSED`, all inside one `$transaction`. `follow` events
      create a contact only. Everything else is `IGNORED` with the payload kept. A
      transaction failure marks the event `FAILED` with the error and moves to the next
      event.
   5. Use `after()` for exactly one thing: `line.getProfile` to backfill `lineDisplayName`
      on a newly created contact. Do not call the AI copilot automatically on inbound
      messages.
   6. Any `FAILED` event in the batch -> respond `500` (so LINE redelivers; already-processed
      events are skipped by dedupe on redelivery). Otherwise respond `200`.
5. Implement `modules/line/service.ts` bodies: `handleLineWebhook` (orchestrates the above),
   `recordInboundMessage`, `enqueueLineMessage`, `deliverQueuedMessage`, and build
   `sendLineMessage` and `retryMessage` on top of those two rather than duplicating the
   enqueue/push/Tx B logic:
   - `enqueueLineMessage(tx, input)` runs inside the caller's transaction, inserts the
     outbound `Message` as `QUEUED` with a fresh `retryKey` (`crypto.randomUUID()`), makes
     no network call, and throws `UNPROCESSABLE` if the contact has no `lineUserId`.
   - `deliverQueuedMessage(messageId, deps)` pushes with the message's *stored* `retryKey`
     (never a new one), retries up to 2 more times on a retryable result (wait 300ms, then
     1200ms, incrementing `attemptCount` each attempt), then runs Tx B to set `SENT` +
     `lineRequestId` (from the LINE `x-line-accepted-request-id` header) on `200`/`409`, or
     `FAILED` + `lastError` otherwise. It refuses (`CONFLICT`) when the message is older than
     `RETRY_KEY_MAX_AGE_MS`.
   - `sendLineMessage` = `enqueueLineMessage` then `deliverQueuedMessage`, as one call.
   - `retryMessage` = a state check (`FAILED`, or `QUEUED` stuck over 60 seconds) then
     `deliverQueuedMessage`.
6. Wire send (`app/api/leads/[id]/messages`, and the send path inside `approveSuggestion`
   that Lane B calls into) and retry (`app/api/messages/[id]/retry`) through `sendLineMessage`
   and `retryMessage` per `docs/design.md` section 5B steps 6 to 9. Both respond `200` in
   either the `SENT` or `FAILED` outcome. **Section 10 addition:** the `retryKey` expires 24
   hours after the first request, so `retryMessage` rejects with `409` when the message's
   `createdAt` is older than 23 hours (`RETRY_KEY_MAX_AGE_MS`), telling the caller to send a
   new message instead (reusing an expired key risks LINE sending the message twice).
7. `findOrOpenLeadForContact` (Lane A's function, called from the webhook path) needs a
   `pg_advisory_xact_lock` on the contact id, taken inside the same transaction, so two
   concurrent webhook deliveries for the same LINE user cannot both decide to open a new
   lead at once. Flag this to Lane A if the lock is missing; do not add it to a file this
   lane does not own.
8. Set `PushResult.retryable` to `true` only for `NETWORK`, `TIMEOUT`, and `5xx`. This is
   the section 10 correction to the original design. Do not auto-retry on `429` within the
   same request; leave it `FAILED` for a human-triggered retry. `401`/`403` are `CONFIG`,
   never retryable, logged at error level.
9. Implement `app/api/dev/line/simulate/route.ts`: admin-only, only when `LINE_MODE=mock`,
   builds and signs a fake LINE event and calls the webhook handler directly, useful for
   local/demo testing without a real LINE account.
10. Build `components/messages/Composer.tsx` against the frozen props, and
    `MessageBubble.tsx` (props are yours to design).
11. `export const runtime = 'nodejs'` explicitly on the webhook route. It needs
    `node:crypto` for `createHmac`/`timingSafeEqual` and must never move to edge.

## Acceptance criteria

Standard flow:

- [ ] A valid signed webhook event is accepted, persisted, and processed
- [ ] Sending a message stores a fresh `retryKey` before the network call, and retry (manual
      or in-request) always reuses that same key
- [ ] Approving a suggestion with `send: true` and no `lineUserId` on the contact fails with
      `422` before any write

Section 10 LINE rules specifically:

- [ ] Wrong signature -> `401`, and nothing is written to the database
- [ ] Signature check happens on raw bytes before `JSON.parse`
- [ ] `PushResult.retryable` is `true` only for `NETWORK`, `TIMEOUT`, `5xx`, never for `2xx`,
      `409`, or any other `4xx` (including `429`)
- [ ] A `409` from LINE (retry key already accepted) is treated as success:
      `{ ok: true, httpStatus: 409, duplicate: true }`, and `lineRequestId` is set from the
      `x-line-accepted-request-id` response header
- [ ] Retry on a message older than 23 hours since `createdAt` returns `409` instead of
      reusing an expired key
- [ ] Duplicate webhook delivery (same `webhookEventId`) returns `200` and does not create a
      second `WebhookEvent`, `Contact`, `Lead`, or `Message` row
- [ ] `401`/`403` from LINE are recorded as `CONFIG` errors, not retried
- [ ] Nothing logs the channel secret, access token, or `x-line-signature` value
- [ ] `npm run typecheck`, `npm run lint`, `npm test` all pass

## What to stub or mock while other lanes are unfinished

The webhook and send paths call into Lane A's `findOrCreateContactByLineUserId` and
`findOrOpenLeadForContact`. Until Lane A's bodies are implemented, those signatures throw
`DomainError('INTERNAL', 'not implemented')`. Write your own unit tests for the webhook
handler with `vi.mock('@/modules/crm/service')` so you can develop and test in isolation,
then re-run against the real implementation once Lane A merges.

`MockLineClient` is your own deliverable. Build it early since Lane B and Lane D both need
it for their own tests.

## Handoff notes

Hand off to integration: `modules/line/*` with all bodies implemented, the webhook/messages/
retry/simulate routes, `Composer`/`MessageBubble`. Lane B's send path inside
`approveSuggestion` depends on `sendLineMessage` and `LineClient` behaving exactly as
specified. Lane D's `line-webhook` test depends on `MockLineClient`'s signature verification
being the real HMAC code, not a stub that always returns `true`.

## Cut list if time runs short

From `docs/design.md`'s risk section: trim the `/api/dev/line/simulate` UI first (keep the
route itself; Lane E's LINE test instructions and the demo depend on it working). Live eval
and tags cuts belong to other lanes, not this one.

## Opening prompt

```
Read AGENTS.md and docs/tasks/lane-C.md, then read docs/design.md section 5A in full, section
5B steps 6 to 10, and all of section 10 (it overrides earlier sections on LINE retry rules
and Prisma). Implement modules/line/signature.ts and client.mock.ts first since Lane B and
Lane D depend on them, then the webhook route, then send and retry.
```
