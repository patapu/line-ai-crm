// OWNER: lane A
//
// Root layout: <html>/<body>, metadata and globals.css only. The real auth
// gate and nav live in app/(app)/layout.tsx; app/(auth)/login has none.

import type { Metadata } from 'next'
import { Nunito, IBM_Plex_Sans_Thai_Looped } from 'next/font/google'
import './globals.css'

const nunito = Nunito({ subsets: ['latin'], variable: '--font-nunito', display: 'swap' })
const plexThai = IBM_Plex_Sans_Thai_Looped({
  weight: ['400', '500', '600', '700'],
  subsets: ['thai'],
  variable: '--font-plex-thai',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'LINE AI CRM',
    template: '%s | LINE AI CRM',
  },
  description: 'AI CRM with LINE OA: take home project',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${nunito.variable} ${plexThai.variable}`}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  )
}
