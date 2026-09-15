// OWNER: lane A (placeholder from layer 0)
//
// Minimal root layout so `next typegen` / `next build` have a valid app tree.
// Lane A owns the real nav, verifySession() gate for (app)/layout.tsx, etc.

import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'line-ai-crm',
  description: 'AI CRM with LINE OA: take home project',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
