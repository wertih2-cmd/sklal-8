import type { BadgeKey } from '@/modules/admin/adminNavModel'

export type ManagerNavKey = 'home' | 'cleanings' | 'incidents' | 'chessboard' | 'apartments'

export interface ManagerNavItem {
  key: ManagerNavKey
  to: string
  /** Match the path exactly (otherwise also everything below it). */
  end?: boolean
  badge?: BadgeKey
}

/** The manager area, in the order of the side panel and of the phone bar. "Apartments" opens the supervisor screens. */
export const MANAGER_NAV_ITEMS: readonly ManagerNavItem[] = [
  { key: 'home', to: '/manager', end: true },
  { key: 'cleanings', to: '/manager/cleaning-approvals', badge: 'cleanings' },
  { key: 'incidents', to: '/manager/incidents', badge: 'incidents' },
  { key: 'chessboard', to: '/manager/chessboard' },
  { key: 'apartments', to: '/sv', end: true },
]

/** The QR app is a separate page of the same site, so it is a plain link, not a route. */
export const QR_APP_PATH = '/qr.html#/qr'

export function isManagerNavActive(pathname: string, item: ManagerNavItem): boolean {
  if (item.end) return pathname === item.to
  return pathname === item.to || pathname.startsWith(item.to + '/')
}

/** Section of the page, for the title of the phone top bar; null for an unknown path. */
export function managerTitleKey(pathname: string): ManagerNavKey | null {
  const item = MANAGER_NAV_ITEMS.find((i) => i.key !== 'apartments' && isManagerNavActive(pathname, i))
  return item ? item.key : null
}
