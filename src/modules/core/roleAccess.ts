import type { AppRole } from '@/lib/database.types'

/**
 * What a role gets in the main app (index.html / sv.html):
 * - admin: the admin panel and the supervisor mode;
 * - manager: the manager area (/manager) and the supervisor screens (/sv);
 * - supervisor: only the supervisor interface (/sv);
 * - none: an unknown role, who can only use the QR app.
 */
export type MainAppAccess = 'admin' | 'manager' | 'supervisor' | 'none'

export function mainAppAccess(role: AppRole): MainAppAccess {
  if (role === 'admin') return 'admin'
  if (role === 'manager') return 'manager'
  if (role === 'supervisor') return 'supervisor'
  return 'none'
}
