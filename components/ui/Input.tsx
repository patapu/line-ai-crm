// OWNER: lane A
import type { InputHTMLAttributes } from 'react'
import { cn } from '@/components/ui/cn'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded-field border border-field-border bg-white px-3 py-2 text-sm text-ink',
        'placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger',
        'disabled:cursor-not-allowed disabled:bg-neutral-soft disabled:text-muted-2',
        className,
      )}
      {...props}
    />
  )
}
