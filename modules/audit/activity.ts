import 'server-only'
import type { Tx } from '@/lib/db'
import type { Activity, ActivityType, Prisma } from '@/lib/generated/prisma/client'
import type { Actor } from '@/lib/auth/dal'

// [F, implemented in layer 0] modules/audit/activity.ts: see docs/design.md
// section 4 and section 1's import rule: `audit` is a leaf module, it must
// never import `crm`, `copilot` or `line`.
//
// `actorId` is null for system actors (LINE webhook, seed) per the
// Activity.actorId doc comment in schema.prisma.
export async function writeActivity(
  tx: Tx,
  input: {
    leadId: string
    type: ActivityType
    body?: string | null
    meta?: Prisma.InputJsonValue
    actor: Actor
  },
): Promise<Activity> {
  return tx.activity.create({
    data: {
      leadId: input.leadId,
      type: input.type,
      body: input.body ?? null,
      meta: input.meta,
      actorId: input.actor.kind === 'user' ? input.actor.id : null,
    },
  })
}
