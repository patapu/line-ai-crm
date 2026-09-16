// OWNER: lane A
//
// Server-safe pager built from next/link + URLSearchParams. `params` should
// already exclude `page` (see queryObject(...) at each call site).

import Link from 'next/link'
import { cn } from '@/components/ui/cn'

export interface PaginationProps {
  page: number
  pageSize: number
  total: number
  basePath: string
  params: Record<string, string>
}

function hrefFor(basePath: string, params: Record<string, string>, page: number): string {
  const usp = new URLSearchParams(params)
  usp.set('page', String(page))
  return `${basePath}?${usp.toString()}`
}

export function Pagination({ page, pageSize, total, basePath, params }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const hasPrev = page > 1
  const hasNext = page < totalPages

  return (
    <div className="flex items-center justify-between gap-4 py-3 text-sm text-slate-600">
      <span>
        หน้า {page} / {totalPages} ({total} รายการ)
      </span>
      <div className="flex gap-2">
        <Link
          aria-disabled={!hasPrev}
          href={hasPrev ? hrefFor(basePath, params, page - 1) : hrefFor(basePath, params, page)}
          className={cn(
            'rounded-md border border-slate-300 px-3 py-1.5',
            hasPrev ? 'bg-white hover:bg-slate-50' : 'pointer-events-none bg-slate-100 text-slate-400',
          )}
        >
          ก่อนหน้า
        </Link>
        <Link
          aria-disabled={!hasNext}
          href={hasNext ? hrefFor(basePath, params, page + 1) : hrefFor(basePath, params, page)}
          className={cn(
            'rounded-md border border-slate-300 px-3 py-1.5',
            hasNext ? 'bg-white hover:bg-slate-50' : 'pointer-events-none bg-slate-100 text-slate-400',
          )}
        >
          ถัดไป
        </Link>
      </div>
    </div>
  )
}
