'use client'

// OWNER: lane A
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { apiFetch } from '@/components/crm/api'

export function LogoutButton() {
  const router = useRouter()

  async function handleClick() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // logout is best-effort client side: clear the cookie server side is
      // idempotent, and we still send the user back to /login below.
    }
    router.replace('/login')
    router.refresh()
  }

  return (
    <Button variant="inverse" size="sm" onClick={handleClick}>
      ออกจากระบบ
    </Button>
  )
}
