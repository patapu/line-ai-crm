// OWNER: lane A
import type { SelectHTMLAttributes } from 'react'
import { cn } from '@/components/ui/cn'

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'w-full rounded-field border border-field-border bg-white px-3 py-2 text-sm text-ink',
        'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger',
        'disabled:cursor-not-allowed disabled:bg-neutral-soft disabled:text-muted-2',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}
