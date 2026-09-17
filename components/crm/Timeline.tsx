'use client'

// OWNER: lane A
//
// Renders both TimelineItem kinds. Activity items keep their own card and
// header; message items render as MessageBubble alone (see CR-4).
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { formatDateTime } from '@/components/ui/format'
import { apiFetch } from '@/components/crm/api'
import { redirectOnUnauthorized } from '@/components/crm/auth-redirect'
import { STAGE_LABEL, STAGES } from '@/components/crm/constants'
import { MessageBubble } from '@/components/messages/MessageBubble'
import type { TimelineItem, TimelinePage } from '@/lib/contracts/timeline'

export interface TimelineProps {
  leadId: string
  initial: TimelinePage
  canRetry: boolean
}

type StageChangedMeta = { from?: string; to?: string; reason?: string | null }
type OwnerChangedMeta = { from?: string | null; to?: string | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stageLabel(stage: string | undefined): string {
  if (stage && (STAGES as readonly string[]).includes(stage)) {
    return STAGE_LABEL[stage as (typeof STAGES)[number]]
  }
  return stage ?? '-'
}

/** Short, human meta line for activity kinds that carry structured `meta` instead of free text `body`. */
function activityMetaLine(item: Extract<TimelineItem, { kind: 'activity' }>): string | null {
  if (item.type === 'STAGE_CHANGED' && isRecord(item.meta)) {
    const meta = item.meta as StageChangedMeta
    const reasonPart = meta.reason ? ` (${meta.reason})` : ''
    return `${stageLabel(meta.from)} -> ${stageLabel(meta.to)}${reasonPart}`
  }
  if (item.type === 'OWNER_CHANGED' && isRecord(item.meta)) {
    const meta = item.meta as OwnerChangedMeta
    return meta.from && meta.to ? 'เปลี่ยนเจ้าของ' : meta.to ? 'กำหนดเจ้าของ' : 'ยกเลิกเจ้าของ'
  }
  return null
}

export function Timeline({ leadId, initial, canRetry }: TimelineProps) {
  const router = useRouter()
  const [items, setItems] = useState<TimelineItem[]>(initial.items)
  const [nextCursor, setNextCursor] = useState<string | null>(initial.nextCursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pure derivation, computed fresh every render: `initial` is the server's latest first page
  // (the lead page re-fetches it on navigation, and MessageBubble's handleRetry calls
  // router.refresh() after a retry). Overlaying it onto `items` by id means a message that is
  // still on that first page shows its current status, attemptCount and lastError right away,
  // without a Timeline remount. Known limit: an item that only exists because of Load more is
  // not on `initial.items`, so retrying it updates on the server but its bubble shows the new
  // state only after a full page reload, or after a new timeline entry remounts Timeline.
  const freshById = new Map(initial.items.map((entry) => [entry.id, entry]))
  const displayItems = items.map((item) => freshById.get(item.id) ?? item)

  async function handleLoadMore() {
    if (!nextCursor) return
    setLoading(true)
    setError(null)
    try {
      const page = await apiFetch<TimelinePage>(
        `/api/leads/${leadId}/timeline?before=${encodeURIComponent(nextCursor)}`,
      )
      setItems((prev) => [...prev, ...page.items])
      setNextCursor(page.nextCursor)
    } catch (err) {
      if (redirectOnUnauthorized(router, err)) return
      setError('โหลดข้อมูลเพิ่มไม่สำเร็จ ลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {displayItems.map((item) =>
        item.kind === 'activity' ? (
          <div key={item.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span suppressHydrationWarning>{formatDateTime(item.at)}</span>
              <Badge tone="gray">{item.type}</Badge>
            </div>
            <div>
              <p className="text-slate-700">{activityMetaLine(item) ?? item.body ?? '-'}</p>
              <p className="mt-1 text-xs text-slate-400">{item.actor ? item.actor.name : 'system'}</p>
            </div>
          </div>
        ) : (
          <MessageBubble key={item.id} message={item} canRetry={canRetry} />
        ),
      )}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {nextCursor ? (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loading}
          className="self-start text-sm text-slate-500 hover:underline disabled:opacity-50"
        >
          {loading ? 'กำลังโหลด...' : 'Load more'}
        </button>
      ) : null}
    </div>
  )
}
