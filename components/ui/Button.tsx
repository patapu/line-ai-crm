// OWNER: lane A
//
// Server-safe UI primitive: no hooks, no 'use client'. React 19 passes `ref`
// as a normal prop, so forwardRef is not needed.

import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/components/ui/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'inverse'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const BUTTON_BASE_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2'

export const BUTTON_VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-2 focus-visible:outline-primary',
  secondary:
    'border border-field-border bg-white text-primary-2 hover:border-primary-2 hover:bg-primary-soft focus-visible:outline-primary',
  danger: 'bg-danger text-white hover:bg-danger-hover focus-visible:outline-danger',
  ghost: 'bg-transparent text-primary-2 hover:bg-primary-soft focus-visible:outline-primary',
  inverse: 'bg-white text-primary hover:bg-primary-soft focus-visible:outline-white',
}

export const BUTTON_SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-3.5 py-1.5 text-sm',
  md: 'min-h-10 px-5 py-2 text-sm max-sm:min-h-11',
}

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        BUTTON_BASE_CLASS,
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANT_CLASS[variant],
        BUTTON_SIZE_CLASS[size],
        className,
      )}
      {...props}
    />
  )
}
