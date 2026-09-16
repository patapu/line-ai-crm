// OWNER: lane A — server-safe presentational component
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { STAGE_LABEL } from '@/components/crm/constants'
import type { LeadStage } from '@/lib/generated/prisma/client'

export interface StageBadgeProps {
  stage: LeadStage
}

const TONE: Record<LeadStage, BadgeTone> = {
  NEW: 'gray',
  QUALIFIED: 'blue',
  PROPOSAL: 'amber',
  WON: 'green',
  LOST: 'red',
}

export function StageBadge({ stage }: StageBadgeProps) {
  return <Badge tone={TONE[stage]}>{STAGE_LABEL[stage]}</Badge>
}
