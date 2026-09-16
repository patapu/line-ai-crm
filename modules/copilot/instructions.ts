import { readFileSync } from 'node:fs'
import path from 'node:path'

// [B1] modules/copilot/instructions.ts: lane owned. No 'server-only' import
// here: modules/copilot/fallback.ts imports PROMPT_VERSION and must stay
// importable from scripts/eval-copilot.ts, which runs the module tree
// outside a request context. See docs/design.md section 4.

export const PROMPT_VERSION = 'crm-copilot-v2'

let cached: string | null = null

export function instructionsPath(): string {
  return path.join(process.cwd(), 'skills', 'crm-copilot', 'instructions.md')
}

/** Reads and memoizes skills/crm-copilot/instructions.md for the process lifetime. */
export function loadInstructions(): string {
  return (cached ??= readFileSync(instructionsPath(), 'utf8'))
}
