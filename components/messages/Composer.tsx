// OWNER: lane C
//
// Props contract frozen per docs/design.md section 1:
// `components/messages/Composer.tsx, MessageBubble.tsx [C] props [F]:
// { leadId: string; canSend: boolean; hasLine: boolean }`
// Layer 0 only freezes the export name and prop shape so app/(app)/leads/[id]/page.tsx
// (Lane A) can mount this component before Lane C implements it.

export interface ComposerProps {
  leadId: string
  canSend: boolean
  hasLine: boolean
}

export function Composer(_props: ComposerProps) {
  return null
}
