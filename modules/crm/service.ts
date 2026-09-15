// [signatures F, bodies A] modules/crm/service.ts: see docs/design.md
// section 4 and section 5B step 2 (changeStage transaction shape).
// Lane A fills in the bodies; layer 0 only freezes the signatures.

import type { z } from 'zod'
import type { Contact, Lead, LeadSource, LeadStage } from '@/lib/generated/prisma/client'
import type { Db, Tx } from '@/lib/db'
import type { Actor } from '@/lib/auth/dal'
import { DomainError } from '@/lib/errors'
import type { Paged } from '@/lib/contracts/common'
import type { LeadCreate, LeadListQuery } from '@/lib/contracts/crm'
import type { TimelinePage, TimelineQuery } from '@/lib/contracts/timeline'
import type { LeadDetail, LeadListItem } from '@/modules/crm/types'

/**
 * One $transaction: read lead -> same stage => {changed:false}, no Activity
 * -> canActOnLead else FORBIDDEN -> updateMany where {id, stage: from}
 * (count 0 => CONFLICT) -> set stageChangedAt, closedAt (WON/LOST) or null,
 * lostReason -> writeActivity STAGE_CHANGED {from,to,reason}
 */
export async function changeStage(
  input: { leadId: string; to: LeadStage; reason?: string; actor: Actor },
  db?: Db,
): Promise<{ lead: Lead; changed: boolean }> {
  void input
  void db
  throw new DomainError('INTERNAL', 'not implemented')
}

export async function createLead(input: z.infer<typeof LeadCreate>, actor: Actor, db?: Db): Promise<Lead> {
  void input
  void actor
  void db
  throw new DomainError('INTERNAL', 'not implemented')
}

export async function listLeads(q: z.infer<typeof LeadListQuery>, db?: Db): Promise<Paged<LeadListItem>> {
  void q
  void db
  throw new DomainError('INTERNAL', 'not implemented')
}

export async function getLeadDetail(id: string, db?: Db): Promise<LeadDetail | null> {
  void id
  void db
  throw new DomainError('INTERNAL', 'not implemented')
}

export async function getLeadTimeline(
  leadId: string,
  q: z.infer<typeof TimelineQuery>,
  db?: Db,
): Promise<TimelinePage> {
  void leadId
  void q
  void db
  throw new DomainError('INTERNAL', 'not implemented')
}

export async function findOrCreateContactByLineUserId(
  tx: Tx,
  input: { lineUserId: string; displayName?: string | null },
): Promise<{ contact: Contact; created: boolean }> {
  void tx
  void input
  throw new DomainError('INTERNAL', 'not implemented')
}

/** latest non WON/LOST, else NEW */
export async function findOrOpenLeadForContact(
  tx: Tx,
  input: { contactId: string; ownerId: string; source: LeadSource; actor: Actor },
): Promise<{ lead: Lead; created: boolean }> {
  void tx
  void input
  throw new DomainError('INTERNAL', 'not implemented')
}
