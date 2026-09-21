// OWNER: lane A
//
// Thin wrapper: children provide raw <thead>/<tbody> markup, this just gives
// consistent scroll and border styling. No column config, no component lib.

import type { TableHTMLAttributes } from 'react'
import { cn } from '@/components/ui/cn'

export function Table({
  label,
  className,
  ...props
}: TableHTMLAttributes<HTMLTableElement> & { label?: string }) {
  const table = (
    <div
      role={label ? 'region' : undefined}
      aria-label={label}
      tabIndex={label ? 0 : undefined}
      className="overflow-x-auto rounded-card border border-line bg-white"
    >
      <table className={cn('w-full text-left text-sm', className)} {...props} />
    </div>
  )

  if (!label) return table

  return (
    <div>
      <p className="mb-2 text-xs text-muted md:hidden">เลื่อนตารางไปทางขวาเพื่อดูคอลัมน์ที่เหลือ</p>
      {table}
    </div>
  )
}
