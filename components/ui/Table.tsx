// OWNER: lane A
//
// Thin wrapper: children provide raw <thead>/<tbody> markup, this just gives
// consistent scroll and border styling. No column config, no component lib.

import type { TableHTMLAttributes } from 'react'
import { cn } from '@/components/ui/cn'

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className={cn('w-full text-left text-sm', className)} {...props} />
    </div>
  )
}
