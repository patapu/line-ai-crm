'use client'

// OWNER: lane A
//
// Renders both TimelineItem kinds. Must never import MessageBubble (lane C
// owns that component and it may not exist yet).
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { formatDateTime } from '@/components/ui/format'
import { apiFetch } from '@/components/crm/api'
import { redirectOnUnauthorized } from '@/components/crm/auth-redirect'
import { STAGE_LABEL, STAGES } from '@/components/crm/constants'
import type { TimelineItem, TimelinePage } from '@/lib/contracts/timeline'

export interface TimelineProps {
  leadId: string
  initial: TimelinePage
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

export function Timeline({ leadId, initial }: TimelineProps) {
  const router = useRouter()
  const [items, setItems] = useState<TimelineItem[]>(initial.items)
  const [nextCursor, setNextCursor] = useState<string | null>(initial.nextCursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      {items.map((item) => (
        <div key={item.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
          <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
            <span suppressHydrationWarning>{formatDateTime(item.at)}</span>
            {item.kind === 'activity' ? (
              <Badge tone="gray">{item.type}</Badge>
            ) : (
              <Badge tone="blue">{item.channel}</Badge>
            )}
          </div>
          {item.kind === 'activity' ? (
            <div>
              <p className="text-slate-700">{activityMetaLine(item) ?? item.body ?? '-'}</p>
              <p className="mt-1 text-xs text-slate-400">{item.actor ? item.actor.name : 'system'}</p>
            </div>
          ) : (
            <div>
              <p className="text-xs text-slate-500">
                {item.direction} · {item.status}
              </p>
              <p className="text-slate-700">{item.body}</p>
              {item.lastError ? <p className="mt-1 text-xs text-red-600">{item.lastError}</p> : null}
            </div>
          )}
        </div>
      ))}
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
