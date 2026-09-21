// OWNER: lane A
//
// Server-safe pager built from next/link + URLSearchParams. `params` should
// already exclude `page` (see queryObject(...) at each call site).

import Link from 'next/link'

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
    <div className="flex items-center justify-between gap-4 py-3 text-sm text-muted">
      <span>
        หน้า {page} / {totalPages} ({total} รายการ)
      </span>
      <div className="flex gap-2">
        {hasPrev ? (
          <Link
            href={hrefFor(basePath, params, page - 1)}
            className="rounded-full border border-field-border bg-white px-4 py-1.5 font-semibold text-primary-2 hover:bg-primary-soft"
          >
            ก่อนหน้า
          </Link>
        ) : (
          <span className="rounded-full border border-line bg-neutral-soft px-4 py-1.5 text-muted-2">
            ก่อนหน้า
          </span>
        )}
        {hasNext ? (
          <Link
            href={hrefFor(basePath, params, page + 1)}
            className="rounded-full border border-field-border bg-white px-4 py-1.5 font-semibold text-primary-2 hover:bg-primary-soft"
          >
            ถัดไป
          </Link>
        ) : (
          <span className="rounded-full border border-line bg-neutral-soft px-4 py-1.5 text-muted-2">
            ถัดไป
          </span>
        )}
      </div>
    </div>
  )
}
