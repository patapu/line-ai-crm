// OWNER: lane A
//
// Server-safe UI primitive: no hooks, no 'use client'. React 19 passes `ref`
// as a normal prop, so forwardRef is not needed.

import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/components/ui/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const BUTTON_VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-700',
  secondary: 'bg-white text-slate-900 border border-slate-300 hover:bg-slate-50',
  danger: 'bg-red-600 text-white hover:bg-red-500',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-100',
}

export const BUTTON_SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
}

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANT_CLASS[variant],
        BUTTON_SIZE_CLASS[size],
        className,
      )}
      {...props}
    />
  )
}
