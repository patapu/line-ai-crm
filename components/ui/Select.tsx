// OWNER: lane A
import type { SelectHTMLAttributes } from 'react'
import { cn } from '@/components/ui/cn'

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900',
        'focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500',
        'disabled:cursor-not-allowed disabled:bg-slate-100',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}
