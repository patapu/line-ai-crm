// OWNER: lane B
//
// Props contract frozen per docs/design.md section 1:
// `components/copilot/InsightPanel.tsx [B] props [F]: { leadId: string; canApprove: boolean }`
// Layer 0 only freezes the export name and prop shape so app/(app)/leads/[id]/page.tsx
// (Lane A) can mount this component before Lane B implements it.

export interface InsightPanelProps {
  leadId: string
  canApprove: boolean
}

export function InsightPanel(_props: InsightPanelProps) {
  return null
}
