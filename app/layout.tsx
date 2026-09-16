// OWNER: lane A
//
// Root layout: <html>/<body>, metadata and globals.css only. The real auth
// gate and nav live in app/(app)/layout.tsx; app/(auth)/login has none.

import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'LINE AI CRM',
  description: 'AI CRM with LINE OA: take home project',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  )
}
