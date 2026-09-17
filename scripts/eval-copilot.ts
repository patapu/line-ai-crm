import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { LeadSourceSchema, LeadStageSchema } from '@/lib/contracts/crm'
import { createCrmCopilot } from '@/modules/copilot/model'
import { suggestWithFallback } from '@/modules/copilot/fallback'
import { detectReplyLocale } from '@/modules/copilot/context'
import type { CopilotOutput, CopilotResult, LeadContext, SuggestDeps } from '@/modules/copilot/types'

// [F4] scripts/eval-copilot.ts: lane owned. See docs/design.md section 4 and
// docs/tasks/lane-B.md step 9. Runs the 7 cases in
// skills/crm-copilot/evals/cases.json against the real Gemini model through
// the exact same `suggestWithFallback` wrapper the app uses, and prints a
// pass/fail table. Never runs in CI; run by hand with `npm run eval:copilot`.
//
// This module is also imported (never executed as a script) by
// modules/copilot/eval-cases.test.ts, which only needs EvalFileSchema,
// buildContextFromCase and checkExpectations. `main()` only runs when this
// file is the process entry point (see the bottom of the file), so importing
// it for its exports has no side effects: no env loading, no file reads, no
// network calls.

const DAY_MS = 86_400_000

const ACTIVITY_TYPES = [
  'LEAD_CREATED',
  'STAGE_CHANGED',
  'OWNER_CHANGED',
  'NOTE',
  'CALL',
  'MEETING',
  'EMAIL',
  'SCORE_APPLIED',
  'AI_SUGGESTION_CREATED',
  'AI_SUGGESTION_APPROVED',
  'AI_SUGGESTION_REJECTED',
  'MESSAGE_SENT',
  'MESSAGE_FAILED',
  'CONTACT_CREATED_FROM_LINE',
] as const

const ERROR_CODES = ['TIMEOUT', 'PROVIDER_ERROR', 'SCHEMA_INVALID', 'NO_API_KEY', 'GUARDRAIL_BLOCKED'] as const

// Matches CopilotOutputSchema.flags / NextBestActionSchema.type in
// lib/contracts/copilot.ts exactly, so a typo in an eval case's `expect`
// block fails to parse instead of silently never matching.
const FLAG_VALUES = [
  'INSUFFICIENT_CONTEXT',
  'PROMPT_INJECTION_SUSPECTED',
  'PRICING_REQUESTED',
  'COMPLAINT',
  'OUT_OF_SCOPE',
] as const
const NBA_TYPES = [
  'REPLY_LINE',
  'CALL',
  'SEND_PROPOSAL',
  'SCHEDULE_MEETING',
  'FOLLOW_UP_LATER',
  'MOVE_STAGE',
  'HANDOFF_TO_HUMAN',
  'CLOSE_LOST',
] as const

const EvalLeadSchema = z.object({
  title: z.string(),
  stage: LeadStageSchema,
  source: LeadSourceSchema,
  value: z.number().nullable(),
  currency: z.string(),
  stageChangedDaysAgo: z.number(),
  createdDaysAgo: z.number(),
  ownerName: z.string(),
})

const EvalContactSchema = z.object({
  firstName: z.string(),
  lastName: z.string().nullable(),
  hasLine: z.boolean(),
  companyName: z.string().nullable(),
  tags: z.array(z.string()),
})

const EvalMessageSchema = z.object({
  daysAgo: z.number(),
  direction: z.enum(['INBOUND', 'OUTBOUND']),
  channel: z.enum(['LINE', 'MANUAL']),
  text: z.string(),
})

const EvalActivitySchema = z.object({
  daysAgo: z.number(),
  type: z.enum(ACTIVITY_TYPES),
  text: z.string().nullable(),
})

const EvalContextSchema = z.object({
  lead: EvalLeadSchema,
  contact: EvalContactSchema,
  recentMessages: z.array(EvalMessageSchema),
  recentActivities: z.array(EvalActivitySchema),
  replyLocale: z.enum(['th', 'en']).nullable(),
})

const EvalExpectSchema = z.object({
  scoreMin: z.number().optional(),
  scoreMax: z.number().optional(),
  nextBestActionIn: z.array(z.enum(NBA_TYPES)).optional(),
  flagsInclude: z.array(z.enum(FLAG_VALUES)).optional(),
  lowConfidence: z.boolean().optional(),
  draftLocale: z.enum(['th', 'en']).optional(),
  draftNull: z.boolean().optional(),
  draftNotNull: z.boolean().optional(),
  draftNotMatch: z.array(z.string()).optional(), // regex sources, always applied with flags 'iu'
  errorCodeIn: z.array(z.enum(ERROR_CODES).nullable()).default([null]),
  source: z.enum(['MODEL', 'FALLBACK']).default('MODEL'),
})

const EvalCaseSchema = z.object({
  id: z.string(),
  bucket: z.enum(['easy', 'ambiguous', 'adversarial']),
  title: z.string(),
  context: EvalContextSchema,
  expect: EvalExpectSchema,
})

export const EvalFileSchema = z.object({
  version: z.literal(1),
  cases: z.array(EvalCaseSchema),
})

export type EvalCase = z.infer<typeof EvalCaseSchema>
export type EvalFile = z.infer<typeof EvalFileSchema>

function isoDaysAgo(now: Date, daysAgo: number): string {
  return new Date(now.getTime() - daysAgo * DAY_MS).toISOString()
}

/** Builds the same LeadContext shape modules/copilot/context.ts produces, straight from an eval case, with no database involved. */
export function buildContextFromCase(c: EvalCase, now: Date): LeadContext {
  const { lead, contact, recentMessages, recentActivities, replyLocale } = c.context

  const messages: LeadContext['recentMessages'] = recentMessages.map((m) => ({
    at: isoDaysAgo(now, m.daysAgo),
    direction: m.direction,
    channel: m.channel,
    text: m.text,
  }))

  const activities: LeadContext['recentActivities'] = recentActivities.map((a) => ({
    at: isoDaysAgo(now, a.daysAgo),
    type: a.type,
    text: a.text,
  }))

  return {
    lead: {
      id: 'eval-' + c.id,
      title: lead.title,
      stage: lead.stage,
      source: lead.source,
      value: lead.value,
      currency: lead.currency,
      stageChangedAt: isoDaysAgo(now, lead.stageChangedDaysAgo),
      createdAt: isoDaysAgo(now, lead.createdDaysAgo),
      ownerName: lead.ownerName,
    },
    contact: {
      firstName: contact.firstName,
      lastName: contact.lastName,
      hasLine: contact.hasLine,
      companyName: contact.companyName,
      tags: contact.tags,
    },
    recentMessages: messages,
    recentActivities: activities,
    now: now.toISOString(),
    replyLocale: replyLocale ?? detectReplyLocale(messages),
  }
}

// COPILOT_MIN_CONFIDENCE keeps its own explicit unset-vs-empty check instead
// of `??`: 0 is a legitimate explicit "accept any confidence" value here, not
// a bug, so it must stay 0 when the var is the literal string "0". An empty
// string (var set but blank) is treated the same as unset (Number("") is 0,
// which would otherwise silently turn into the same "accept any confidence"
// value nobody asked for). Exported (pulled out of main()) so this parsing
// rule can be unit tested without spawning the script or touching env vars.
// Anything outside [0, 1], including a non-numeric string, throws a fixed
// message that never echoes the raw value back, so a stray secret-shaped env
// var never leaks into the thrown error/its log line.
export function parseMinConfidence(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 0.5
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('COPILOT_MIN_CONFIDENCE must be a number from 0 to 1')
  }
  return value
}

/** Empty array = pass. Every entry is one expectation the result failed. */
export function checkExpectations(c: EvalCase, result: CopilotResult): string[] {
  const { expect } = c
  const { output } = result
  const failures: string[] = []

  if (result.source !== expect.source) {
    failures.push(`expected source ${expect.source}, got ${result.source}`)
  }

  if (!expect.errorCodeIn.includes(result.errorCode)) {
    failures.push(`expected errorCode in [${expect.errorCodeIn.join(', ')}], got ${result.errorCode}`)
  }

  if (expect.scoreMin !== undefined && output.score < expect.scoreMin) {
    failures.push(`expected score >= ${expect.scoreMin}, got ${output.score}`)
  }

  if (expect.scoreMax !== undefined && output.score > expect.scoreMax) {
    failures.push(`expected score <= ${expect.scoreMax}, got ${output.score}`)
  }

  if (expect.nextBestActionIn && !expect.nextBestActionIn.includes(output.nextBestAction.type)) {
    failures.push(`expected nextBestAction in [${expect.nextBestActionIn.join(', ')}], got ${output.nextBestAction.type}`)
  }

  if (expect.flagsInclude) {
    const missing = expect.flagsInclude.filter((flag) => !output.flags.includes(flag))
    if (missing.length > 0) failures.push(`expected flags to include [${missing.join(', ')}], got [${output.flags.join(', ')}]`)
  }

  if (expect.lowConfidence !== undefined && result.lowConfidence !== expect.lowConfidence) {
    failures.push(`expected lowConfidence ${expect.lowConfidence}, got ${result.lowConfidence}`)
  }

  if (expect.draftNull && output.draftReply !== null) {
    failures.push('expected draftReply to be null')
  }

  if (expect.draftNotNull && output.draftReply === null) {
    failures.push('expected draftReply to be non-null')
  }

  if (expect.draftLocale !== undefined) {
    if (output.draftReply === null) failures.push(`expected draftReply.locale ${expect.draftLocale}, got null draftReply`)
    else if (output.draftReply.locale !== expect.draftLocale)
      failures.push(`expected draftReply.locale ${expect.draftLocale}, got ${output.draftReply.locale}`)
  }

  if (expect.draftNotMatch && output.draftReply) {
    for (const source of expect.draftNotMatch) {
      if (new RegExp(source, 'iu').test(output.draftReply.text)) {
        failures.push(`draftReply text matched forbidden pattern /${source}/iu`)
      }
    }
  }

  return failures
}

interface Row {
  index: number
  id: string
  bucket: EvalCase['bucket']
  source: CopilotResult['source']
  errorCode: string
  score: number
  nba: CopilotOutput['nextBestAction']['type']
  flags: string
  lowConfidence: boolean
  ms: number
  verdict: 'PASS' | 'FAIL' | 'SKIP'
  reasons: string
}

function printTable(rows: Row[]): void {
  const columns: Array<{ key: keyof Row; header: string }> = [
    { key: 'index', header: '#' },
    { key: 'id', header: 'id' },
    { key: 'bucket', header: 'bucket' },
    { key: 'source', header: 'source' },
    { key: 'errorCode', header: 'errorCode' },
    { key: 'score', header: 'score' },
    { key: 'nba', header: 'nba' },
    { key: 'flags', header: 'flags' },
    { key: 'lowConfidence', header: 'lowConf' },
    { key: 'ms', header: 'ms' },
    { key: 'verdict', header: 'PASS/FAIL/SKIP' },
    { key: 'reasons', header: 'reasons' },
  ]

  const widths = columns.map((col) =>
    Math.max(col.header.length, ...rows.map((row) => String(row[col.key]).length)),
  )

  const formatRow = (values: string[]): string => values.map((value, i) => value.padEnd(widths[i])).join(' | ')

  console.log(formatRow(columns.map((col) => col.header)))
  console.log(widths.map((w) => '-'.repeat(w)).join('-|-'))
  for (const row of rows) {
    console.log(formatRow(columns.map((col) => String(row[col.key]))))
  }
}

async function main(): Promise<void> {
  // Set before dotenv loads: dotenv's config() never overrides a variable
  // that is already present in process.env, and .env in this repo sets
  // LOG_LEVEL="info", so setting this after config() would silently never
  // take effect (the eval would stay noisy unless the shell itself exports
  // LOG_LEVEL).
  process.env.LOG_LEVEL ??= 'error'

  try {
    const { config } = await import('dotenv')
    config({ quiet: true })
  } catch {
    try {
      process.loadEnvFile?.('.env')
    } catch {
      // No dotenv package and no .env file to load: fall back to whatever is
      // already in process.env (e.g. a CI-style exported environment).
    }
  }

  const casesPath = path.join(process.cwd(), 'skills', 'crm-copilot', 'evals', 'cases.json')
  const raw: unknown = JSON.parse(readFileSync(casesPath, 'utf8'))
  const file = EvalFileSchema.parse(raw)

  const ids = new Set(file.cases.map((c) => c.id))
  if (ids.size !== file.cases.length || file.cases.length !== 7) {
    console.error(`Expected 7 cases with unique ids, found ${file.cases.length} cases (${ids.size} unique ids).`)
    process.exit(1)
  }

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  // `??` only falls back on null/undefined: an empty-string env var (e.g.
  // COPILOT_TIMEOUT_MS="") would otherwise become Number("") === 0, a
  // useless zero timeout. `||` falls back on any falsy Number() result
  // instead, including NaN and 0.
  const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS) || 8000
  const minConfidence = parseMinConfidence(process.env.COPILOT_MIN_CONFIDENCE)

  const copilot = createCrmCopilot({
    apiKey,
    modelId: process.env.COPILOT_MODEL ?? 'gemini-flash-latest',
    timeoutMs,
  })
  const deps: SuggestDeps = { copilot, timeoutMs, minConfidence }

  if (!apiKey) {
    console.log(
      'GOOGLE_GENERATIVE_AI_API_KEY is not set: cases ran through the rule-based fallback only, the model was NOT evaluated',
    )
  }

  const rows: Row[] = []
  let anyFail = false

  for (const [i, c] of file.cases.entries()) {
    const now = new Date()
    const ctx = buildContextFromCase(c, now)
    const result = await suggestWithFallback(ctx, deps)

    const failures = apiKey ? checkExpectations(c, result) : []
    const verdict: Row['verdict'] = !apiKey ? 'SKIP' : failures.length > 0 ? 'FAIL' : 'PASS'
    if (verdict === 'FAIL') anyFail = true

    // Only preview the (synthetic) draft text on a failing row, to keep
    // passing rows compact; never print anything else from the draft/summary.
    const preview =
      verdict === 'FAIL' && result.output.draftReply ? ` | draft: "${result.output.draftReply.text.slice(0, 60)}"` : ''

    rows.push({
      index: i + 1,
      id: c.id,
      bucket: c.bucket,
      source: result.source,
      errorCode: result.errorCode ?? 'null',
      score: result.output.score,
      nba: result.output.nextBestAction.type,
      flags: result.output.flags.join('|'),
      lowConfidence: result.lowConfidence,
      ms: result.latencyMs,
      verdict,
      reasons: failures.join('; ') + preview,
    })
  }

  printTable(rows)

  if (!apiKey) process.exit(2)
  process.exit(anyFail ? 1 : 0)
}

if (/eval-copilot\.ts$/.test(process.argv[1] ?? '')) {
  main().catch((err: unknown) => {
    console.error('eval-copilot crashed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
