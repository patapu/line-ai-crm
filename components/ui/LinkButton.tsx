// OWNER: lane A
//
// A next/link that is styled like Button, for navigation that looks like a
// button ("New lead", "View all", ...).

import Link from 'next/link'
import type { ComponentProps } from 'react'
import { cn } from '@/components/ui/cn'
import {
  BUTTON_BASE_CLASS,
  BUTTON_SIZE_CLASS,
  BUTTON_VARIANT_CLASS,
  type ButtonSize,
  type ButtonVariant,
} from '@/components/ui/Button'

export interface LinkButtonProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function LinkButton({ variant = 'primary', size = 'md', className, ...props }: LinkButtonProps) {
  return (
    <Link
      className={cn(BUTTON_BASE_CLASS, BUTTON_VARIANT_CLASS[variant], BUTTON_SIZE_CLASS[size], className)}
      {...props}
    />
  )
}
