// [F] lib/log.ts: writes one JSON line per event to stdout (stderr for
// level 'error'), after redacting secret-shaped fields recursively and
// dropping anything below the LOG_LEVEL threshold. See docs/design.md
// section 7. No pino: it complicates bundling under Turbopack/serverless,
// and a single `console.log(JSON.stringify(...))` line is enough for Vercel
// Logs to index by field.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogFields {
  [key: string]: unknown
}

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

function currentThreshold(): number {
  const raw = process.env.LOG_LEVEL
  const level: LogLevel = raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' ? raw : 'info'
  return LEVEL_WEIGHT[level]
}

/**
 * Field names that must never reach stdout as-is: channel secrets, access
 * tokens, signatures, passwords, emails, phone numbers, and anything shaped
 * like a URL, DSN or DB connection string (design section 7's "ห้าม log"
 * list). Matches on the KEY name, not the value, so any field shaped like a
 * secret is redacted regardless of caller intent, at any nesting depth.
 *
 * `retryKey` is deliberately NOT matched here: design section 7's sample log
 * line logs it in the clear (it is an idempotency UUID, not a credential).
 */
const REDACT_KEY_RE =
  /secret|token|signature|password|apikey|api_key|authorization|cookie|email|phone|url$|dsn|connection|databaseurl/i

const REDACTED = '[REDACTED]'
const MAX_DEPTH = 5

/** Keys whose value is logged only as its length, never its content. */
const LENGTH_ONLY_KEYS = new Set(['text', 'body'])

function lengthOf(value: unknown): number {
  if (typeof value === 'string') return value.length
  if (Array.isArray(value)) return value.length
  return 0
}

/** Redacts one already-nested value, recursing into objects and arrays. `seen` is an ancestor stack, not a visited set: it is cleared on the way back out, so the same object appearing twice in a non-cyclic structure is not flagged. */
function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]'
  if (seen.has(value)) return '[CIRCULAR]'

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, depth + 1, seen))
    }
    const safe: LogFields = {}
    for (const [key, val] of Object.entries(value as LogFields)) {
      safe[key] = redactEntry(key, val, depth + 1, seen)
    }
    return safe
  } finally {
    seen.delete(value)
  }
}

function redactEntry(key: string, value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (LENGTH_ONLY_KEYS.has(key)) return `[len:${lengthOf(value)}]`
  if (REDACT_KEY_RE.test(key)) return REDACTED
  return redactValue(value, depth, seen)
}

function redact(fields: LogFields): LogFields {
  const seen = new WeakSet<object>()
  const safe: LogFields = {}
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = redactEntry(key, value, 0, seen)
  }
  return safe
}

/**
 * Writes one JSON line to stdout (or stderr for level 'error'), after
 * redaction and framing. `fields` should follow the shape in design section
 * 7 (requestId, route, userId, leadId, ... durationMs, err), but any shape is
 * accepted. Events below the LOG_LEVEL threshold (debug < info < warn <
 * error, default info) are dropped without writing anything.
 */
export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (LEVEL_WEIGHT[level] < currentThreshold()) return

  const env = process.env.NODE_ENV ?? 'development'
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    service: 'ai-crm',
    env,
    ...redact(fields),
  }

  let serialized: string
  try {
    serialized = JSON.stringify(line)
  } catch {
    serialized = JSON.stringify({
      ts: line.ts,
      level,
      event,
      service: 'ai-crm',
      env,
      logError: 'unserializable',
    })
  }

  if (level === 'error') {
    console.error(serialized)
  } else {
    console.log(serialized)
  }
}
