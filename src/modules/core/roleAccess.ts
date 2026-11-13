import type { AppRole } from '@/lib/database.types'

/**
 * Что роль получает в основном приложении (index.html / sv.html):
 * - admin: админка и режим супервайзера;
 * - supervisor: только интерфейс супервайзера (/sv);
 * - none: менеджер работает только через QR-приложение.
 */
export type MainAppAccess = 'admin' | 'supervisor' | 'none'

export function mainAppAccess(role: AppRole): MainAppAccess {
  if (role === 'admin') return 'admin'
  if (role === 'supervisor') return 'supervisor'
  return 'none'
}
