import { redirect } from 'next/navigation'
import { getActor } from '@/lib/admin'
import { AdminContent } from '@/components/admin-content'

/**
 * /admin — platform admin panel. Server-guarded: only admins/superadmins get
 * in; everyone else is bounced home. The «Админка» sidebar entry is likewise
 * gated by role, but the real check lives here (and in every admin action).
 */
export default async function AdminPage() {
  const actor = await getActor()
  if (!actor || actor.isAnonymous || actor.role === 'user') redirect('/')
  return (
    <main className="min-h-svh flex-1 overflow-y-auto bg-background">
      <AdminContent isSuperadmin={actor.isSuperadmin} />
    </main>
  )
}
