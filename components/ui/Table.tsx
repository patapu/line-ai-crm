// OWNER: lane A
//
// Thin wrapper: children provide raw <thead>/<tbody> markup, this just gives
// consistent scroll and border styling. No column config, no component lib.

import type { TableHTMLAttributes } from 'react'
import { cn } from '@/components/ui/cn'

export type TableMinWidth = 'sm' | 'md'

export const TABLE_MIN_WIDTH_CLASS: Record<TableMinWidth, string> = {
  sm: 'min-w-[640px]',
  md: 'min-w-[720px]',
}

export type TableProps = TableHTMLAttributes<HTMLTableElement> & { label?: string; minWidth?: TableMinWidth }

export function Table({ label, minWidth, className, ...props }: TableProps) {
  const table = (
    <div
      role={label ? 'region' : undefined}
      aria-label={label}
      tabIndex={label ? 0 : undefined}
      className="overflow-x-auto rounded-card border border-line bg-white"
    >
      <table
        className={cn('w-full text-left text-sm', minWidth && TABLE_MIN_WIDTH_CLASS[minWidth], className)}
        {...props}
      />
    </div>
  )

  if (!label) return table

  return (
    <div>
      <p className="mb-2 text-xs text-muted lg:hidden">เลื่อนตารางไปทางขวาเพื่อดูคอลัมน์ที่เหลือ</p>
      {table}
    </div>
  )
}
