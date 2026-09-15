// [signatures F, bodies B] modules/copilot/service.ts: see docs/design.md
// section 4 and section 5B (draft -> approve -> send flow). Lane B fills in
// the bodies; layer 0 only freezes the signatures.

import type { AiSuggestion, Message } from '@/lib/generated/prisma/client'
import type { Db } from '@/lib/db'
import type { Actor } from '@/lib/auth/dal'
import { DomainError } from '@/lib/errors'
import type { LineClient } from '@/modules/line/types'
import type { suggestWithFallback } from '@/modules/copilot/fallback'

export async function requestInsight(
  input: { leadId: string; actor: Actor; replyLocale?: 'th' | 'en' },
  deps: { suggest?: typeof suggestWithFallback; db?: Db },
): Promise<AiSuggestion> {
  void input
  void deps
  throw new DomainError('INTERNAL', 'not implemented')
}

export async function approveSuggestion(
  input: { suggestionId: string; actor: Actor; send: boolean; replyText?: string; applyScore: boolean },
  deps: { line: LineClient; db?: Db },
): Promise<{ suggestion: AiSuggestion; message: Message | null }> {
  void input
  void deps
  throw new DomainError('INTERNAL', 'not implemented')
}

export async function rejectSuggestion(
  input: { suggestionId: string; actor: Actor; reason?: string },
  db?: Db,
): Promise<AiSuggestion> {
  void input
  void db
  throw new DomainError('INTERNAL', 'not implemented')
}
